import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { AuditCredentialKind, AuditDecision, AuditVia } from './audit-event.js';

/**
 * One audit row per HTTP request, in the service's own database (table
 * `audit_log`, SPEC-audit-log §8.2, §9.11).
 *
 * Exactly the intent's 14 fields and nothing else: the table is access-only, so
 * it has no column that could hold an `Authorization` value, a cookie value, a
 * raw query string, a request or response body, or a row snapshot. What is not
 * a column cannot be written by mistake.
 *
 * Column types stay driver-portable (`text` / `integer` / `Date`, the `UserKeys`
 * pattern) because the repo runs sqlite in dev and e2e and restores Postgres:
 * a driver literal like `datetime` is sqlite-only and `timestamptz` is
 * Postgres-only. `id` is a service-generated `randomUUID()` set before insert,
 * not a database default, so the same entity works on both drivers.
 */
@Entity('audit_log')
export class AuditEntry {
  /** `randomUUID()`, set by the listener before insert (SPEC §9.11). */
  @PrimaryColumn({ type: 'text' })
  id: string;

  /**
   * Request-arrival time in UTC. Indexed because the reviewer hat reads a time
   * range (SPEC §8.9); this is the only index the capability adds.
   */
  @Index()
  @Column({ type: Date })
  occurredAt: Date;

  /** OIDC subject, or `null` for an unauthenticated request. */
  @Column({ type: 'text', nullable: true })
  actorSub: string | null;

  /** Self-declared `x-caller-service` claim. Never verified, never decisive. */
  @Column({ type: 'text', nullable: true })
  callerService: string | null;

  /** `anonymous` / `oidc-cookie` / `bearer` / `service-call` (SPEC §9.3). */
  @Column({ type: 'text' })
  via: AuditVia;

  /** `cookie` / `bearer` / `none` — the kind present, never the value. */
  @Column({ type: 'text' })
  credentialKind: AuditCredentialKind;

  /** The HTTP method as received. */
  @Column({ type: 'text' })
  method: string;

  /** The route template (`/notes/:id`) or the `(unmatched)` sentinel. */
  @Column({ type: 'text' })
  route: string;

  /** The status the response ended on. */
  @Column({ type: 'integer' })
  status: number;

  /** `allowed` / `denied` / `error`, derived from `status` alone (SPEC §9.4). */
  @Column({ type: 'text' })
  decision: AuditDecision;

  /** Weak apparent source address. Hints only; never an access input. */
  @Column({ type: 'text', nullable: true })
  sourceIp: string | null;

  /** Claimed client, one-line sanitized and capped at 256 chars (SPEC §9.10). */
  @Column({ type: 'text' })
  userAgent: string;

  /** Whole milliseconds the request took. */
  @Column({ type: 'integer' })
  durationMs: number;

  /** Correlates with the service's own logs; not a cross-service trace id. */
  @Column({ type: 'text' })
  requestId: string;
}
