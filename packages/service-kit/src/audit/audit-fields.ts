/**
 * Derivation of the audit fields that are computed rather than observed: `via`,
 * `credentialKind`, `decision`, the route template, and the sanitized
 * `userAgent` (SPEC-audit-log §9.3, §9.4, §9.6, §9.10).
 *
 * Every function here is pure and reads presence only — credential *values* never
 * reach this module, so there is nothing here that could leak one into a row.
 */
import type { AuditCredentialKind, AuditDecision, AuditVia } from './audit-event.js';

/** Stored for a request that matched no route: a fixed sentinel, never the path. */
export const UNMATCHED_ROUTE = '(unmatched)';

/** The stored length of a `userAgent`; a client can send any length it likes. */
export const MAX_USER_AGENT_LENGTH = 256;

/** The stored length of a client-supplied `x-request-id`; same hostile-text reason. */
export const MAX_REQUEST_ID_LENGTH = 64;

/** The stored length of a client-supplied `x-caller-service`; same hostile-text reason. */
export const MAX_CALLER_SERVICE_LENGTH = 64;

/**
 * Which credentials a request presented, reduced to presence. This is the whole
 * input to `via` and `credentialKind`: the derivation never needs a value, so it
 * cannot accidentally keep one. `hasCallerClaim` is the self-declared
 * `x-caller-service` header — a claim, not a credential (SPEC §9.2).
 */
export interface CredentialPresence {
  hasSessionCookie: boolean;
  hasBearerToken: boolean;
  hasCallerClaim: boolean;
}

/**
 * The credential kind, most authoritative first: a session cookie wins over a
 * bearer token, matching `deriveVia`'s precedence so the two fields never tell
 * different stories about one request.
 */
export function deriveCredentialKind(credentials: CredentialPresence): AuditCredentialKind {
  if (credentials.hasSessionCookie) return 'cookie';
  if (credentials.hasBearerToken) return 'bearer';
  return 'none';
}

/**
 * The four-value `via`, in precedence order: no credential is `anonymous`, a
 * cookie is `oidc-cookie`, a bearer token alone is `bearer`, and a bearer token
 * *plus* a caller claim is a `service-call` (SPEC §9.3).
 *
 * `oidc-cookie` is unreachable while every service's `AuthGuard` is
 * bearer-only; the value is specified anyway, and this rule selects it the
 * moment cookie traffic exists (SPEC §10.2).
 */
export function deriveVia(credentials: CredentialPresence): AuditVia {
  if (!credentials.hasSessionCookie && !credentials.hasBearerToken) return 'anonymous';
  if (credentials.hasSessionCookie) return 'oidc-cookie';
  return credentials.hasCallerClaim ? 'service-call' : 'bearer';
}

/**
 * What the service did, read off the status alone (SPEC §9.4): anything under
 * 400 was allowed, a 401 or 403 is a denial, and every other failure is an
 * error. Status is the only input, so a row can never claim a decision the
 * response contradicts.
 */
export function deriveDecision(status: number): AuditDecision {
  if (status < 400) return 'allowed';
  if (status === 401 || status === 403) return 'denied';
  return 'error';
}

/**
 * The stored route: the matched template, or the `(unmatched)` sentinel when
 * routing found none (SPEC §9.6). A concrete path is never stored — a 404 or an
 * unrecognised path could carry anything, and a template cannot.
 */
export function deriveRoute(routeTemplate: string | null | undefined): string {
  if (routeTemplate === null || routeTemplate === undefined) return UNMATCHED_ROUTE;
  if (routeTemplate.length === 0) return UNMATCHED_ROUTE;
  return routeTemplate;
}

/**
 * The stored `userAgent`: collapsed to one printable line and capped at
 * `MAX_USER_AGENT_LENGTH` (SPEC §9.10). A client controls this string, so it is
 * treated as hostile text — control characters and newlines become spaces, and
 * the tail past the cap is dropped rather than stored.
 */
export function sanitizeUserAgent(userAgent: string | null | undefined): string {
  return oneLine(userAgent ?? '').slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * The stored `callerService`: an inbound `x-caller-service` collapsed to one
 * printable line and capped, else `null` (owned by the middleware). Like
 * `requestId` and `userAgent` this header is client-controlled, so it is hostile
 * text: a newline in it would forge a log line and an unbounded one would bloat
 * the row. It stays a *claim* either way — sanitized text does not make it true.
 */
export function sanitizeCallerService(callerService: string | null | undefined): string | null {
  const sanitized = oneLine(callerService ?? '').slice(0, MAX_CALLER_SERVICE_LENGTH);
  return sanitized.length === 0 ? null : sanitized;
}

/**
 * The stored `requestId`: an inbound `x-request-id` collapsed to one printable
 * line and capped, else a fresh UUID (owned by the middleware). A client controls
 * that header, so it is hostile text exactly like `userAgent` — a newline in it
 * would forge a log line, and an unbounded one would bloat the row.
 */
export function sanitizeRequestId(requestId: string | null | undefined): string | null {
  const sanitized = oneLine(requestId ?? '').slice(0, MAX_REQUEST_ID_LENGTH);
  return sanitized.length === 0 ? null : sanitized;
}

/**
 * One line of printable ASCII, the shape of `apps/idp/scripts/oidc-dance.ts`'s
 * `oneLine`: everything outside the printable range, including newlines, folds
 * to a single space, and the ends are trimmed.
 */
function oneLine(value: string): string {
  return value.replace(/[^\u0020-\u007e]+/g, ' ').trim();
}
