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
}

interface AuthorizedWire {
  wire: WireRequest;
  token: string;
}

/** One executor per service endpoint; adapters share this call, never re-implement it. */
export function createExecutor(options: ExecutorOptions): Executor {
  const endpoint: ServiceEndpoint = { baseUrl: options.baseUrl, readToken: options.readToken };
  return {
    registry: options.registry,
    run: (kind, input) => execute(endpoint, { registry: options.registry, kind, input }),
  };
}

async function execute(endpoint: ServiceEndpoint, call: OperationCall): Promise<OpsResult> {
  rejectInvalidInput(call);
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
  const response = await fetch(addressFor(endpoint.baseUrl, wire), requestFor({ wire, token }));
  if (!response.ok) throw await failureFromResponse(labelFor(call), response);
  return response;
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

function requestFor(authorized: AuthorizedWire): RequestInit {
  return {
    method: authorized.wire.method,
    headers: headersFor(authorized),
    body: bodyText(authorized.wire),
  };
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
