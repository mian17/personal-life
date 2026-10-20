/**
 * The one HTTP executor (SPEC.md §3): both adapters call `run` and nothing else
 * on the network path. Validation happens here before any socket opens, the
 * Bearer token comes from the shared store, cursor pagination passes through
 * untouched, and every failure leaves as an OpsError (`./errors`).
 */
import type { OpSpec, ResourceRegistry, WireRequest } from '../core/types';
import { findOp } from '../core/registry';
import { validateInput } from '../core/validate';
import { wireFor } from '../core/wire';
import {
  deadlineExceededError,
  failureFromResponse,
  invalidInputError,
  missingTokenError,
  operationLabel,
  parseServiceBody,
} from './errors';

export interface ExecutorOptions {
  registry: ResourceRegistry;
  baseUrl: string;
  /** Reads the stored IdP access token; `undefined` means "run `life-ops login`". */
  readToken: () => Promise<string | undefined>;
  /** Per-call deadline in ms; defaults to `30_000`, and `0` waits for the service forever. */
  deadlineMs?: number;
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

interface ServiceEndpoint {
  baseUrl: string;
  readToken: () => Promise<string | undefined>;
  deadlineMs: number;
}

interface AuthorizedWire {
  wire: WireRequest;
  token: string;
}

/** The budget governing one call: the operation name it names and its millisecond deadline. */
interface CallDeadline {
  operation: string;
  deadlineMs: number;
}

/** One executor per service endpoint; adapters share this call, never re-implement it. */
export function createExecutor(options: ExecutorOptions): Executor {
  const endpoint: ServiceEndpoint = {
    baseUrl: options.baseUrl,
    readToken: options.readToken,
    deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
  };
  return {
    registry: options.registry,
    run: (kind, input) => execute(endpoint, { registry: options.registry, kind, input }),
  };
}

async function execute(endpoint: ServiceEndpoint, call: OperationCall): Promise<OpsResult> {
  rejectInvalidInput(call);
  return await withinDeadline(deadlineFor(endpoint, call), exchange(endpoint, call));
}

/** The send plus its body read: one span, so a body that stalls mid-stream is timed out too. */
async function exchange(endpoint: ServiceEndpoint, call: OperationCall): Promise<OpsResult> {
  const response = await sendCall(endpoint, call);
  return { status: response.status, body: await readBody(response) };
}

function rejectInvalidInput(call: OperationCall): void {
  const issues = validateInput(findOp(call.registry, call.kind), call.input);
  if (issues.length === 0) return;
  throw invalidInputError(labelFor(call), issues);
}

async function sendCall(endpoint: ServiceEndpoint, call: OperationCall): Promise<Response> {
  const token = await requireToken(endpoint, call);
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
 * `timeout` OpsError; every other failure is rethrown untouched.
 */
async function withinDeadline<T>(budget: CallDeadline, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (budget.deadlineMs === 0 || !isAbort(error)) throw error;
    throw deadlineExceededError(budget.operation, budget.deadlineMs);
  }
}

function deadlineFor(endpoint: ServiceEndpoint, call: OperationCall): CallDeadline {
  return { operation: labelFor(call), deadlineMs: endpoint.deadlineMs };
}

/** Node throws a `DOMException` here, which is not an `Error` subclass, so only its name is reliable. */
function isAbort(error: unknown): boolean {
  const thrownName = (error as { name?: unknown } | null)?.name;
  return thrownName === 'TimeoutError' || thrownName === 'AbortError';
}

async function requireToken(endpoint: ServiceEndpoint, call: OperationCall): Promise<string> {
  const token = await endpoint.readToken();
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
