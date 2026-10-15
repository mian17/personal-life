import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FEEDBACK_TYPE_VALUES, type FeedbackType } from '@life/shared';
import { Feedback } from './feedback.entity';

/**
 * The transactional event log (`SPEC-feedback-service` Event stream). One row
 * per `feedback` insert, written in the same transaction. **Metadata only** —
 * the event payload never carries the title or the description, as plaintext or
 * as ciphertext.
 *
 * - `seq` is the total order of the log (`BIGSERIAL`); the dispatcher's cursor
 *   resumes strictly after it. pg surfaces `bigint` as `string`; T9 compares
 *   and advances it in SQL, never in JS.
 * - `event_id` equals the feedback `id` and is the consumer's dedup key (one
 *   row per feedback id).
 * - `feedback_id` keeps the log honest about the row it describes.
 * - `dispatched_at` stays `NULL` until the publish confirm (observability only).
 *
 * The dispatcher side (trigger DDL, LISTEN, publisher) is T9.
 */
@Entity('feedback_event')
@Check('CHK_feedback_event_type', `type IN (${FEEDBACK_TYPE_VALUES.map((v) => `'${v}'`).join(',')})`)
export class FeedbackEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  seq: string;

  @Column({ type: 'uuid', unique: true })
  eventId: string;

  @Column({ type: 'uuid' })
  feedbackId: string;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'text' })
  app: string;

  @Column({ type: 'text' })
  type: FeedbackType;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @ManyToOne(() => Feedback, { nullable: false })
  @JoinColumn({ name: 'feedbackId' })
  feedback: Feedback;
}
