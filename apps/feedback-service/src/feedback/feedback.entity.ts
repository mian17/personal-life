import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { FEEDBACK_TYPE_VALUES, type FeedbackType } from '@life/shared';

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
 * `CHK_feedback_type` is built from the shared vocabulary so the DB CHECK and
 * the DTO's `@IsIn` can never drift (lesson 0016: one owner per rule).
 */
@Entity('feedback')
@Check('CHK_feedback_type', `type IN (${FEEDBACK_TYPE_VALUES.map((v) => `'${v}'`).join(',')})`)
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

  /** `enc.v1.` envelope; never plaintext. */
  @Column({ type: 'text' })
  title: string;

  /** `enc.v1.` envelope; never plaintext. */
  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
