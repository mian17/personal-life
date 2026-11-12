import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One "tell another service" intent, stored *in the same transaction* as the
 * meal row it belongs to (`docs/roadmap/research/outbox-atomicity.md` §1, §5).
 *
 * A row here is evidence that an event is owed: a committed meal write can
 * never lose its notification, and a rolled-back one can never send it. The
 * poller (`OutboxPollerService`) is the only reader and the only writer of
 * `publishedAt`, so a crash between "sent" and "marked sent" re-sends rather
 * than loses — at-least-once, which is the whole point of the pattern.
 *
 * `lastError` is one capped line, never a stack: the column is a retry
 * diagnostic, not a log sink.
 */
@Entity('meal_outbox')
@Index('IDX_meal_outbox_pending', ['publishedAt', 'createdAt'])
export class Outbox {
  /** Service-generated (`randomUUID`) before insert — the id is the delivery identity. */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** The user the intent belongs to; every delivery carries this owner's identity. */
  @Column({ type: 'text' })
  ownerSub: string;

  /** Logical target, e.g. `todos.create` / `todos.complete` — not a URL. */
  @Column({ type: 'text' })
  destination: string;

  /** The JSON body, already serialized by the caller (never re-shaped here). */
  @Column({ type: 'text' })
  payload: string;

  /** Set by the writer at enqueue time, so ordering never depends on a DB clock. */
  @Column({ type: 'datetime' })
  createdAt: Date;

  /** Null means pending — the poller's `WHERE publishedAt IS NULL` read. */
  @Column({ type: 'datetime', nullable: true })
  publishedAt: Date | null;

  /** Bumped by the poller on every failed delivery; bounds a poison row's retries. */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  /** One line, capped at 256 chars — never a stack trace, never the payload. */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
