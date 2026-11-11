/**
 * The one audit event shape every service emits (SPEC-audit-log §8.4, §9.11):
 * the intent's 14 fields minus `id`. The listener mints the `id` on write, so an
 * event describes only what the request path witnessed.
 *
 * The row is **access-only**. Never written, in any field: `Authorization` and
 * cookie values, the raw query string (this repo rides `USDA_API_KEY` on one),
 * request or response bodies, and before/after row snapshots. Nothing here may
 * carry one, because the entity has no column that could hold it.
 */
export interface AuditEvent {
  /** Request-arrival time in UTC, taken at middleware entry (SPEC §9.5). */
  occurredAt: Date;
  /**
   * The OIDC subject the request was for, or `null` when it presented no usable
   * credential. A null here is information: the service saw an anonymous caller.
   */
  actorSub: string | null;
  /**
   * Which service the request claims to come from. A **self-declared claim**
   * (the `x-caller-service` header, SPEC §9.2), never verified, and never an
   * input to an access decision.
   */
  callerService: string | null;
  /** How the request authenticated; derived from credential presence alone (§9.3). */
  via: AuditVia;
  /** Which kind of credential was present. The value itself is never kept. */
  credentialKind: AuditCredentialKind;
  /** The HTTP method as received. */
  method: string;
  /** The matched route **template** (`/notes/:id`), or the `(unmatched)` sentinel. */
  route: string;
  /** The response status the request ended on. */
  status: number;
  /** Derived from `status` only (SPEC §9.4). */
  decision: AuditDecision;
  /**
   * The address the request appeared to come from. **Weak**: compose-internal
   * addresses are uninformative, so this field hints and never decides.
   */
  sourceIp: string | null;
  /**
   * The client the request claims to be, `oneLine`-sanitized and capped at
   * `MAX_USER_AGENT_LENGTH`. A **claim**: self-reported, never an input to an
   * access decision.
   */
  userAgent: string;
  /** How long the request took, in whole milliseconds. */
  durationMs: number;
  /**
   * The inbound `x-request-id`, else a per-request `randomUUID()`. Correlates
   * with the service's own logs; not a cross-service trace id (§9.7).
   */
  requestId: string;
}

/** The four ways a request can authenticate, most specific last (SPEC §9.3). */
export type AuditVia = 'anonymous' | 'oidc-cookie' | 'bearer' | 'service-call';

/** Which credential was present — the kind, never the value (SPEC §9.3). */
export type AuditCredentialKind = 'cookie' | 'bearer' | 'none';

/** What the service did with the request, read off its status (SPEC §9.4). */
export type AuditDecision = 'allowed' | 'denied' | 'error';

/**
 * The in-process audit bus: a `node:events` `EventEmitter` behind this token
 * (SPEC §9.9). A token rather than the class keeps `node:events` an
 * implementation detail, so a test can inject a recording sink.
 */
export const AUDIT_EMITTER = Symbol('AUDIT_EMITTER');
