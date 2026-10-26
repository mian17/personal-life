import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  FEEDBACK_STATUS_VALUES,
  FEEDBACK_TYPE_VALUES,
  type FeedbackStatus,
  type FeedbackType,
} from '@life/shared';

/** The vocabularies as SQL literal lists, so each CHECK cannot drift from `@life/shared`. */
const TYPE_VALUES_SQL = FEEDBACK_TYPE_VALUES.map((v) => `'${v}'`).join(',');
const STATUS_VALUES_SQL = FEEDBACK_STATUS_VALUES.map((v) => `'${v}'`).join(',');

/**
 * The feedback row (`SPEC-feedback-service` Data model). `title` and
 * `description` are `enc.v1.` envelopes with AADs
 * `life.v1|<sub>|feedback|title|<id>` and
 * `life.v1|<sub>|feedback|description|<id>`; every other column is metadata.
 * `id` is the client-supplied idempotency key, never generated — the AAD binds
 * it, so it exists before the ciphertext is produced.
 *
 * `IDX_feedback_owner_created` backs the one list read. The spec's DDL is
 * `(owner_sub, created_at DESC, id DESC)`; TypeORM's `@Index` has no per-column
 * direction, so this emits an ASC btree — Postgres scans a btree backward for
 * `ORDER BY created_at DESC, id DESC`, so the plan is identical.
 *
 * `CHK_feedback_type` and `CHK_feedback_status` are built from the shared
 * vocabularies so each DB CHECK and its DTO's `@IsIn` can never drift
 * (lesson 0016: one owner per rule).
 */
@Entity('feedback')
@Check('CHK_feedback_type', `type IN (${TYPE_VALUES_SQL})`)
@Check('CHK_feedback_status', `status IN (${STATUS_VALUES_SQL})`)
@Index('IDX_feedback_owner_created', ['ownerSub', 'createdAt', 'id'])
export class Feedback {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'text' })
  app: string;

  @Column({ type: 'text' })
  type: FeedbackType;

  /**
   * Plaintext workflow metadata alongside `app`/`type`, never an `enc.v1.`
   * envelope: a status is operational state, not content, so it carries no
   * AAD (`SPEC-feedback-status` Data model). The DB fills `open` on insert, so
   * the submit flow never sends a status.
   */
  @Column({ type: 'text', default: 'open' })
  status: FeedbackStatus;

  /** `enc.v1.` envelope; never plaintext. */
  @Column({ type: 'text' })
  title: string;

  /** `enc.v1.` envelope; never plaintext. */
  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
