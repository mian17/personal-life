/**
 * The one HTTP executor (SPEC.md §3, SPEC-bulk-ops §2.6): both adapters call
 * `run` and nothing else on the network path. Validation happens here before any
 * socket opens, the Bearer token comes from the shared store, cursor pagination
 * passes through untouched, and every failure leaves as an OpsError (`./errors`).
 * A bulk kind is a strategy inside this executor — one source-kind request per
 * submitted item, then the envelope — never a second executor.
 */
import type { BulkEnvelope, BulkItemResult, BulkKind } from '../core/bulk';
import {
  assembleBulkEnvelope,
  bulkItemInput,
  bulkSourceKind,
  isBulkKind,
} from '../core/bulk';
import type { OpSpec, ResourceRegistry, WireRequest } from '../core/types';
import { findOp } from '../core/registry';
import { BULK_WRAPPER_FIELD, validateInput } from '../core/validate';
import { wireFor } from '../core/wire';
import {
  deadlineExceededError,
  expiredCredentialsError,
  failureFromResponse,
  invalidInputError,
  missingTokenError,
  operationLabel,
  OpsError,
  parseServiceBody,
  RefreshRejected,
  renderOpsError,
  transportFailureError,
} from './errors';

export interface ExecutorOptions {
  registry: ResourceRegistry;
  baseUrl: string;
  /** Reads the stored IdP access token; `undefined` means "run `npm run ops -- login`". */
  readToken: () => Promise<string | undefined>;
  /** Per-call deadline in ms; defaults to `30_000`, and `0` waits for the service forever. */
  deadlineMs?: number;
  /** The cap one bulk call may submit; omitted means `resolveBulkLimit(process.env)` decides. */
  bulkLimit?: number;
}

/** The default budget both adapters inherit (§3.4); `0` from either seam disables it. */
const DEFAULT_DEADLINE_MS = 30_000;

/**
 * `LIFE_OPS_DEADLINE_MS` sets the per-call deadline; `0` disables it, a broken value falls
 * back to the default. A pure read of the environment, so the adapter owns the policy and
 * the executor only ever receives a number.
 */
export function resolveDeadlineMs(env: NodeJS.ProcessEnv): number {
  const configured = env.LIFE_OPS_DEADLINE_MS?.trim();
  if (configured === undefined || configured === '') return DEFAULT_DEADLINE_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DEADLINE_MS;
  return parsed;
}

export interface OpsResult {
  status: number;
  body: unknown;
}

export interface Executor {
  readonly registry: ResourceRegistry;
  run(kind: OpSpec['kind'], input: Record<string, unknown>): Promise<OpsResult>;
}

interface OperationCall {
  registry: ResourceRegistry;
  kind: OpSpec['kind'];
  input: Record<string, unknown>;
}

/** A call on a bulk op: the kind fans out, so it names one of the four (§2.1). */
interface BulkCall extends OperationCall {
  kind: BulkKind;
}

interface ServiceEndpoint {
  baseUrl: string;
  readToken: () => Promise<string | undefined>;
  deadlineMs: number;
  bulkLimit: number | undefined;
}

/** One finished batch's worth of fan-out: the call it came from, its token, and its items. */
interface BulkBatch {
  endpoint: ServiceEndpoint;
  call: BulkCall;
  token: string;
  items: unknown[];
}

/** One submitted item, at the 0-based position the envelope reports it at (§2.7). */
interface SubmittedItem {
  batch: BulkBatch;
  index: number;
  item: unknown;
}

interface AuthorizedWire {
  wire: WireRequest;
  token: string;
}

/** The budget governing one call: the operation it names, where it went, and its deadline. */
interface CallDeadline {
  operation: string;
  baseUrl: string;
  deadlineMs: number;
}

/** One executor per service endpoint; adapters share this call, never re-implement it. */
export function createExecutor(options: ExecutorOptions): Executor {
  const endpoint: ServiceEndpoint = {
    baseUrl: options.baseUrl,
    readToken: options.readToken,
    deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    bulkLimit: options.bulkLimit,
  };
  return {
    registry: options.registry,
    run: (kind, input) => execute(endpoint, { registry: options.registry, kind, input }),
  };
}

async function execute(endpoint: ServiceEndpoint, call: OperationCall): Promise<OpsResult> {
  rejectInvalidInput(endpoint, call);
  if (isBulkKind(call.kind)) return await executeBulk(endpoint, { ...call, kind: call.kind });
  return await withinDeadline(deadlineFor(endpoint, call), exchange(endpoint, call));
}

/**
 * The fan-out (§2.6): the batch is validated and its token read before item 0, so
 * a call-level failure produces no envelope and no request. Each item's own
 * failure is that item's entry, and the envelope is the body.
 */
async function executeBulk(endpoint: ServiceEndpoint, call: BulkCall): Promise<OpsResult> {
  const token = await requireToken(endpoint, call);
  const batch: BulkBatch = { endpoint, call, token, items: submittedItems(call.input) };
  const results = await runBatch(batch);
  const envelope: BulkEnvelope = assembleBulkEnvelope(results);
  return { status: 200, body: envelope };
}

/** A read batch may interleave its items; a write batch runs them one at a time (§2.6). */
async function runBatch(batch: BulkBatch): Promise<BulkItemResult[]> {
  if (itemsMayInterleave(batch.call.kind)) return await runInterleaved(batch);
  return await runInSubmitOrder(batch);
}

function itemsMayInterleave(kind: BulkKind): boolean {
  return kind === 'getMany';
}

async function runInterleaved(batch: BulkBatch): Promise<BulkItemResult[]> {
  return await Promise.all(batch.items.map((item, index) => runItem({ batch, index, item })));
}

/** Item *i+1* is not sent until item *i* settles, so a partial write stays readable (§2.6). */
async function runInSubmitOrder(batch: BulkBatch): Promise<BulkItemResult[]> {
  const results: BulkItemResult[] = [];
  for (const [index, item] of batch.items.entries()) {
    results.push(await runItem({ batch, index, item }));
  }
  return results;
}

/** One item's request, its own deadline, and its own outcome either way (§2.6, §2.7). */
async function runItem(submitted: SubmittedItem): Promise<BulkItemResult> {
  try {
    return await attemptedItem(submitted);
  } catch (error) {
    if (!(error instanceof OpsError)) throw error;
    return failedItem(submitted, renderOpsError(error));
  }
}

async function attemptedItem(submitted: SubmittedItem): Promise<BulkItemResult> {
  const call = itemCall(submitted);
  const budget = deadlineFor(submitted.batch.endpoint, call);
  const result = await withinDeadline(budget, exchangeAuthorized(submitted.batch, call));
  return succeededItem(submitted, result.body);
}

/** `ref` is the single-row body, and a bodiless delete has none to carry (§2.7). */
function succeededItem(submitted: SubmittedItem, body: unknown): BulkItemResult {
  return {
    index: submitted.index,
    status: 'succeeded',
    item: submitted.item,
    ...(body === undefined ? {} : { ref: body }),
  };
}

function failedItem(submitted: SubmittedItem, message: string): BulkItemResult {
  return { index: submitted.index, status: 'failed', item: submitted.item, error: message };
}

/** The item as the single-row call it becomes: its own wire, its own canonical label (§2.3). */
function itemCall(submitted: SubmittedItem): OperationCall {
  return {
    registry: submitted.batch.call.registry,
    kind: sourceKindOf(submitted.batch.call.kind),
    input: bulkItemInput(submitted.batch.call.kind, submitted.item),
  };
}

/** A bulk kind always fans out over a single-row sibling, so the lookup cannot miss here. */
function sourceKindOf(kind: BulkKind): OpSpec['kind'] {
  const sourceKind = bulkSourceKind(kind);
  if (sourceKind !== undefined) return sourceKind;
  throw new Error(`bulk kind ${kind} has no single-row source kind`);
}

function submittedItems(input: Record<string, unknown>): unknown[] {
  return input[BULK_WRAPPER_FIELD] as unknown[];
}

/** The send plus its body read: one span, so a body that stalls mid-stream is timed out too. */
async function exchange(endpoint: ServiceEndpoint, call: OperationCall): Promise<OpsResult> {
  const response = await sendCall(endpoint, call);
  return { status: response.status, body: await readBody(response) };
}

/** A batch item's send: the token was read once before item 0, so this only spends it. */
async function exchangeAuthorized(batch: BulkBatch, call: OperationCall): Promise<OpsResult> {
  const response = await sendAuthorized(batch.endpoint, call, batch.token);
  return { status: response.status, body: await readBody(response) };
}

function rejectInvalidInput(endpoint: ServiceEndpoint, call: OperationCall): void {
  const operation = findOp(call.registry, call.kind);
  const issues = validateInput(operation, call.input, endpoint.bulkLimit);
  if (issues.length === 0) return;
  throw invalidInputError(labelFor(call), issues);
}

async function sendCall(endpoint: ServiceEndpoint, call: OperationCall): Promise<Response> {
  return await sendAuthorized(endpoint, call, await requireToken(endpoint, call));
}

async function sendAuthorized(
  endpoint: ServiceEndpoint,
  call: OperationCall,
  token: string,
): Promise<Response> {
  const wire = wireFor(call.registry, call.kind, call.input);
  const response = await sendWire(endpoint, { wire, token });
  if (!response.ok) throw await failureFromResponse(labelFor(call), response);
  return response;
}

/** The one `fetch`: the deadline signal rides on this request and nothing polls it. */
async function sendWire(endpoint: ServiceEndpoint, authorized: AuthorizedWire): Promise<Response> {
  const address = addressFor(endpoint.baseUrl, authorized.wire);
  return await fetch(address, requestFor(authorized, endpoint.deadlineMs));
}

/**
 * The deadline covers the whole call — request, headers, and body stream — because
 * `AbortSignal.timeout` also rejects a body read that outlives it. An abort leaves as the
 * `timeout` OpsError; a typed failure passes through; anything else means the service was
 * never reached (or never answered coherently), so it leaves typed and naming its origin.
 */
async function withinDeadline<T>(budget: CallDeadline, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isAbort(error) && budget.deadlineMs !== 0) {
      throw deadlineExceededError(budget.operation, budget.deadlineMs);
    }
    if (error instanceof OpsError) throw error;
    throw transportFailureError(budget.operation, originOf(budget.baseUrl), error);
  }
}

function deadlineFor(endpoint: ServiceEndpoint, call: OperationCall): CallDeadline {
  return { operation: labelFor(call), baseUrl: endpoint.baseUrl, deadlineMs: endpoint.deadlineMs };
}

/** Scheme, host and port only: a user's query never reaches a rendered detail. */
function originOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/** Node throws a `DOMException` here, which is not an `Error` subclass, so only its name is reliable. */
function isAbort(error: unknown): boolean {
  const thrownName = (error as { name?: unknown } | null)?.name;
  return thrownName === 'TimeoutError' || thrownName === 'AbortError';
}

async function requireToken(endpoint: ServiceEndpoint, call: OperationCall): Promise<string> {
  let token: string | undefined;
  try {
    token = await endpoint.readToken();
  } catch (error) {
    if (error instanceof RefreshRejected) {
      throw expiredCredentialsError(labelFor(call), error.message);
    }
    throw error;
  }
  if (token === undefined) throw missingTokenError(labelFor(call));
  return token;
}

function labelFor(call: OperationCall): string {
  return operationLabel(call.registry, call.kind);
}

/** `baseUrl` keeps any path prefix; the wire path is appended to it. */
function addressFor(baseUrl: string, wire: WireRequest): URL {
  const url = new URL(stripLeadingSlashes(wire.path), withTrailingSlash(baseUrl));
  for (const [name, value] of Object.entries(wire.query)) url.searchParams.set(name, value);
  return url;
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function stripLeadingSlashes(path: string): string {
  return path.replace(/^\/+/, '');
}

function requestFor(authorized: AuthorizedWire, deadlineMs: number): RequestInit {
  const signal = signalFor(deadlineMs);
  return {
    method: authorized.wire.method,
    headers: headersFor(authorized),
    body: bodyText(authorized.wire),
    ...(signal === undefined ? {} : { signal }),
  };
}

/** A zero deadline means unbounded, and `AbortSignal.timeout(0)` would abort at once. */
function signalFor(deadlineMs: number): AbortSignal | undefined {
  return deadlineMs > 0 ? AbortSignal.timeout(deadlineMs) : undefined;
}

function headersFor(authorized: AuthorizedWire): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${authorized.token}` };
  if (carriesPayload(authorized.wire)) headers['content-type'] = 'application/json';
  return headers;
}

/** An empty body object carries nothing; fetch also rejects any body on GET. */
function carriesPayload(wire: WireRequest): boolean {
  return wire.body !== undefined && Object.keys(wire.body).length > 0;
}

function bodyText(wire: WireRequest): string | undefined {
  return carriesPayload(wire) ? JSON.stringify(wire.body) : undefined;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return text === '' ? undefined : (parseServiceBody(text) ?? text);
}
