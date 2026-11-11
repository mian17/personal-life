/**
 * The capture seam: exactly one audit event per HTTP request, emitted when the
 * response ends — including requests a guard rejected and requests the client
 * aborted (SPEC-audit-log §8.3, §9.12).
 *
 * A middleware rather than an interceptor, because middleware runs *before*
 * guards: a 401 or 403 that no controller ever sees still produces its one row.
 *
 * Emission is fire-and-forget and fail-open (§8.5, §8.6): the event leaves after
 * the response is gone, the listener's write is never awaited, and a listener
 * that throws changes neither the status nor the body. With no emitter at all —
 * an app that never imported `AuditModule` — emission is a no-op.
 *
 * Access-only by construction (§8.4): this module reads credential *presence*
 * and never a credential value, so no header value, cookie, query string or body
 * has a path into the event. That is why the request shape below names the six
 * things the audit is allowed to look at and nothing else.
 */
import { Inject, Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AUDIT_EMITTER, type AuditEvent } from './audit-event.js';
import {
  deriveCredentialKind,
  deriveDecision,
  deriveRoute,
  deriveVia,
  sanitizeCallerService,
  sanitizeRequestId,
  sanitizeUserAgent,
  type CredentialPresence,
} from './audit-fields.js';

/** The event name the emitter publishes under; the module subscribes to it. */
export const AUDIT_EVENT_NAME = 'audit.request';

/** The inbound correlation header, else a per-request `randomUUID()` (§9.7). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** The self-declared caller claim: a claim, never a credential (§9.2). */
export const CALLER_SERVICE_HEADER = 'x-caller-service';

/**
 * The app's session cookie name (`apps/app/lib/auth`). A cookie only counts as a
 * session credential when it carries this name; any other cookie is unrelated
 * state and must not change how the request is reported as authenticated.
 */
export const SESSION_COOKIE_NAME = 'app_session';

/**
 * The slice of a request this middleware reads. Narrow on purpose: a field that
 * is not named here cannot be read, so it cannot be stored either.
 */
export interface AuditRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  baseUrl?: string;
  ip?: string;
  route?: { path?: string };
  principal?: { sub?: string };
  /** Set by this middleware so the service's own logs can correlate (§9.7). */
  auditRequestId?: string;
}

/** The slice of a response this middleware reads: its status, and its ending. */
export interface AuditResponse {
  statusCode: number;
  once(event: 'finish' | 'close', listener: () => void): unknown;
}

/**
 * The global audit middleware. `emitter` is optional so a test app — or a module
 * imported without `forRoot()` — still constructs it and audits nothing.
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware<AuditRequest, AuditResponse> {
  constructor(@Optional() @Inject(AUDIT_EMITTER) private readonly emitter?: EventEmitter) {}

  use(request: AuditRequest, response: AuditResponse, next: () => void): void {
    const capture = beginCapture(request, this.emitter);
    const endCapture = () => finishCapture(capture, response);
    response.once('finish', endCapture);
    response.once('close', endCapture);
    next();
  }
}

/** What the request path witnessed, held between arrival and the response end. */
interface RequestCapture {
  request: AuditRequest;
  emitter?: EventEmitter;
  occurredAt: Date;
  startedAtMs: number;
  requestId: string;
  /** The route Express left on the request for this middleware's own mount. */
  mountedRoute?: { path?: string };
  hasRecorded: boolean;
}

/** Take the arrival facts once, before any guard can reject the request (§9.5). */
function beginCapture(request: AuditRequest, emitter?: EventEmitter): RequestCapture {
  const requestId = requestIdFor(request);
  request.auditRequestId = requestId;
  return {
    request,
    emitter,
    occurredAt: new Date(),
    startedAtMs: Date.now(),
    requestId,
    mountedRoute: request.route,
    hasRecorded: false,
  };
}

/**
 * Record the response once. `finish` and `close` both fire for a completed
 * response, and only `close` fires for a client abort, so the first of the two
 * decides and the second is ignored (§9.12).
 */
function finishCapture(capture: RequestCapture, response: AuditResponse): void {
  if (capture.hasRecorded) return;
  capture.hasRecorded = true;
  emitAuditEvent(capture.emitter, describeAuditEvent(capture, response));
}

/** The 13 witnessed fields of one request, derived where derivable (§8.4). */
function describeAuditEvent(capture: RequestCapture, response: AuditResponse): AuditEvent {
  const credentials = credentialPresence(capture.request);
  const status = response.statusCode;
  return {
    occurredAt: capture.occurredAt,
    actorSub: capture.request.principal?.sub ?? null,
    callerService: sanitizeCallerService(headerValue(capture.request, CALLER_SERVICE_HEADER)),
    via: deriveVia(credentials),
    credentialKind: deriveCredentialKind(credentials),
    method: capture.request.method,
    route: deriveRoute(matchedRouteTemplate(capture)),
    status,
    decision: deriveDecision(status),
    sourceIp: capture.request.ip ?? null,
    userAgent: sanitizeUserAgent(headerValue(capture.request, 'user-agent')),
    durationMs: Date.now() - capture.startedAtMs,
    requestId: capture.requestId,
  };
}

/** The inbound `x-request-id`, sanitized, else a fresh `randomUUID()` (§9.7). */
function requestIdFor(request: AuditRequest): string {
  const inbound = sanitizeRequestId(headerValue(request, REQUEST_ID_HEADER));
  return inbound ?? randomUUID();
}

/** Presence only: no credential value is read, so no value can be kept (§8.4). */
function credentialPresence(request: AuditRequest): CredentialPresence {
  return {
    hasSessionCookie: hasSessionCookie(headerValue(request, 'cookie')),
    hasBearerToken: isBearerAuthorization(headerValue(request, 'authorization')),
    hasCallerClaim: headerValue(request, CALLER_SERVICE_HEADER) !== null,
  };
}

/**
 * Whether a `Cookie` header carries this app's session cookie — not merely
 * whether some cookie exists. Any unrelated cookie (`theme=dark`) used to make
 * `via` report `oidc-cookie` while `actorSub` named a bearer-token subject, so
 * the row contradicted itself and the stronger signal was masked. The name is
 * read; the value never is.
 */
function hasSessionCookie(cookieHeader: string | null): boolean {
  if (cookieHeader === null) return false;
  return cookieHeader.split(';').some((pair) => {
    const [name] = pair.split('=');
    return name.trim() === SESSION_COOKIE_NAME;
  });
}

/** `Bearer` in any case; the scheme is read and the token behind it is not. */
function isBearerAuthorization(authorization: string | null): boolean {
  if (authorization === null) return false;
  const [scheme] = authorization.split(' ');
  return scheme.toLowerCase() === 'bearer';
}

/**
 * The template the app matched (`/notes/:id`), or `null` when nothing did (§9.6).
 * Express leaves this middleware's own mount pattern on the request, so a route
 * identical to the one seen at arrival means no app route ever ran.
 */
function matchedRouteTemplate(capture: RequestCapture): string | null {
  const route = capture.request.route;
  if (route === undefined || route === capture.mountedRoute) return null;
  return `${capture.request.baseUrl ?? ''}${route.path ?? ''}`;
}

/** One header as text, or `null` when absent or repeated. */
function headerValue(request: AuditRequest, name: string): string | null {
  const value = request.headers[name];
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  return value;
}

/**
 * Fail-open emission (§8.5, §8.6): the response is already sent, so a listener
 * that throws synchronously stops at this `catch` instead of reaching the
 * response or the process. Without an emitter this is the no-op fallback.
 */
function emitAuditEvent(emitter: EventEmitter | undefined, event: AuditEvent): void {
  try {
    emitter?.emit(AUDIT_EVENT_NAME, event);
  } catch {
    return;
  }
}
