/**
 * The listener half of the audit bus: one `AuditEvent` in, one `audit_log` row
 * out, written **fire-and-forget and fail-open** (SPEC-audit-log §7, §8.5).
 *
 * Two rules shape this module:
 *
 * - The write is never awaited by the request path. The listener returns
 *   immediately and the row lands (or does not) afterwards.
 * - A failing write changes nothing observable. The rejection is handled here,
 *   so a broken database cannot fail a request, cannot surface an error, and
 *   cannot become an unhandled rejection.
 *
 * The audit path deliberately touches no cache: these rows are append-only
 * telemetry with no read flow, so there is nothing to read through the
 * read-through cache (`## Cache Rules` deviation).
 */
import { randomUUID } from 'node:crypto';
import type { AuditEntry } from './audit-entry.entity.js';
import type { AuditEvent } from './audit-event.js';

/** What the emitter calls for each audited request. Synchronous by contract. */
export type AuditListener = (event: AuditEvent) => void;

/**
 * The write seam: save one row. The service's TypeORM repository in production,
 * a recording fake in tests — the listener depends on nothing wider.
 */
export interface AuditRowWriter {
  save(row: AuditEntry): Promise<unknown>;
}

/**
 * The listener an emitter resolves to when nothing is registered, so an app
 * without `AuditModule` behaves exactly as it does today: emission is a no-op,
 * never an error (SPEC §8.6).
 */
export const NOOP_AUDIT_LISTENER: AuditListener = () => undefined;

/** The listener the emitter will call: the registered one, else the no-op fallback. */
export function resolveAuditListener(registered?: AuditListener): AuditListener {
  return registered ?? NOOP_AUDIT_LISTENER;
}

/**
 * Build the listener that writes through `writer`. The returned function
 * returns before the write finishes, which is what keeps the audit out of the
 * request's latency and out of its failure modes.
 */
export function createAuditListener(writer: AuditRowWriter): AuditListener {
  return (event) => {
    void saveWithoutSurfacingFailure(writer, toAuditEntry(event));
  };
}

/**
 * The row for one event: the minted `id` plus the event's 13 witnessed fields,
 * copied one at a time and never spread. An event that somehow carries extra
 * properties — a header value, a query string, a body — therefore cannot
 * smuggle one into a column, because the table has no column for it and this
 * function names only what it stores (SPEC §8.4).
 */
function toAuditEntry(event: AuditEvent): AuditEntry {
  return {
    id: randomUUID(),
    occurredAt: event.occurredAt,
    actorSub: event.actorSub,
    callerService: event.callerService,
    via: event.via,
    credentialKind: event.credentialKind,
    method: event.method,
    route: event.route,
    status: event.status,
    decision: event.decision,
    sourceIp: event.sourceIp,
    userAgent: event.userAgent,
    durationMs: event.durationMs,
    requestId: event.requestId,
  };
}

/**
 * Fail-open write: a rejected save stops at the `catch` and dies there. Handled,
 * it is not an unhandled rejection; swallowed, it never reaches the request path
 * and no error is logged upward (SPEC §7 — accepted loss, no shutdown drain).
 */
async function saveWithoutSurfacingFailure(writer: AuditRowWriter, row: AuditEntry): Promise<void> {
  try {
    await writer.save(row);
  } catch {
    return;
  }
}
