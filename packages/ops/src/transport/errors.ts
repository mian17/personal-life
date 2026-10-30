/**
 * The one error both adapters render (SPEC.md §3): every transport failure —
 * refused auth, absent rows, stale versions, dead services — arrives here as
 * an OpsError, and both adapters print renderOpsError(error) verbatim.
 * Adapter output parity is a string comparison on that rendering.
 */
import type { OpSpec, ResourceRegistry, ValidationIssue } from '../core/types';

export type OpsErrorCode =
  | 'invalidInput'
  | 'unauthenticated'
  | 'notFound'
  | 'conflict'
  | 'requestFailed'
  | 'timeout';

export interface OpsFailure {
  operation: string;
  code: OpsErrorCode;
  status?: number;
  detail: string;
}

export class OpsError extends Error {
  readonly code: OpsErrorCode;
  readonly status: number | undefined;
  readonly operation: string;

  constructor(failure: OpsFailure) {
    super(canonicalMessage(failure));
    this.name = 'OpsError';
    this.code = failure.code;
    this.status = failure.status;
    this.operation = failure.operation;
  }
}

/** `sample.get` — the operation string every canonical message cites. */
export function operationLabel(registry: ResourceRegistry, kind: OpSpec['kind']): string {
  return `${registry.name}.${kind}`;
}

/** The canonical rendering both adapters print verbatim. */
export function renderOpsError(error: OpsError): string {
  return error.message;
}

/** The local failure raised before any socket opens: the input failed its descriptor. */
export function invalidInputError(operation: string, issues: ValidationIssue[]): OpsError {
  const detail = issues.map((issue) => `${issue.field}: ${issue.reason}`).join('; ');
  return new OpsError({ operation, code: 'invalidInput', detail });
}

/** The deadline firing: the service never answered, so there is no HTTP status to report. */
export function deadlineExceededError(operation: string, deadlineMs: number): OpsError {
  return new OpsError({
    operation,
    code: 'timeout',
    detail: `${operation} did not answer within ${deadlineMs} ms`,
  });
}

/** What a refused or unreachable rotation reads as. */
export const REFRESH_REJECTED_DETAIL = 'credentials expired and the refresh was rejected';

/** The 401-shaped local failure: no token, so the user must log in first. */
export function missingTokenError(operation: string): OpsError {
  return new OpsError({
    operation,
    code: 'unauthenticated',
    status: 401,
    detail: 'no token found, run `npm run ops -- login` first',
  });
}

/**
 * What the token provider raises when rotation is needed and cannot deliver: the store
 * held credentials whose access token had expired, so this is a dead credential, never a
 * forgotten login. Only the executor knows which operation asked for the token.
 */
export class RefreshRejected extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'RefreshRejected';
  }
}

/** The 401-shaped local failure a rejected rotation becomes once its operation is known. */
export function expiredCredentialsError(operation: string, detail: string): OpsError {
  return new OpsError({
    operation,
    code: 'unauthenticated',
    status: 401,
    detail: `${detail}, run \`npm run ops -- login\``,
  });
}

/** The service was never reached, so there is no HTTP status to report — only where it lives. */
export function transportFailureError(
  operation: string,
  endpoint: string,
  cause: unknown,
): OpsError {
  const reason = messageOf(cause);
  return new OpsError({
    operation,
    code: 'requestFailed',
    detail: reason === undefined ? `cannot reach ${endpoint}` : `cannot reach ${endpoint}: ${reason}`,
  });
}

/** A cause's own words, or nothing — never `String()` of an unknown, which prints `[object Object]`. */
function messageOf(cause: unknown): string | undefined {
  const message = cause instanceof Error ? cause.message : undefined;
  return message === undefined || message === '' ? undefined : message;
}

/** Map an HTTP failure to the typed OpsError adapters render. */
export async function failureFromResponse(
  operation: string,
  response: Response,
): Promise<OpsError> {
  const body = await response.text();
  const code = codeForStatus(response.status);
  return new OpsError({
    operation,
    code,
    status: response.status,
    detail: detailFromBody(body, response, code),
  });
}

function canonicalMessage(failure: OpsFailure): string {
  return `${failure.operation} failed (${failure.code}): ${failure.detail}`;
}

function codeForStatus(status: number): OpsErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  return 'requestFailed';
}

function detailFromBody(body: string, response: Response, code: OpsErrorCode): string {
  const statusLine = statusLineFor(response);
  const prose = serviceMessage(body);
  if (prose === undefined) return statusLine;
  // 401/404/409 already name themselves through the code; `requestFailed` is the catch-all,
  // so there the number is the only thing telling a caller's mistake from a service fault.
  return code === 'requestFailed' ? `${statusLine}: ${prose}` : prose;
}

/** `statusText` is empty over HTTP/2, so the number never trails a stray space. */
function statusLineFor(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

function serviceMessage(body: string): string | undefined {
  if (body === '') return undefined;
  return messageFromJson(parseServiceBody(body));
}

/** A service body as JSON, or `undefined` when it is not JSON at all. */
export function parseServiceBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function messageFromJson(parsed: unknown): string | undefined {
  if (typeof parsed === 'string') return parsed;
  if (isStringList(parsed)) return parsed.join('; ');
  if (isJsonObject(parsed)) return messageFromObject(parsed);
  return undefined;
}

function isStringList(parsed: unknown): parsed is string[] {
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string');
}

function isJsonObject(parsed: unknown): parsed is Record<string, unknown> {
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
}

function messageFromObject(parsed: Record<string, unknown>): string | undefined {
  const message = parsed['message'];
  if (typeof message === 'string') return message;
  if (isStringList(message)) return message.join('; ');
  return undefined;
}
