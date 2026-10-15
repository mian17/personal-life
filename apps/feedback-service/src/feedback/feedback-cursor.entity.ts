import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The dispatcher's resume point (`SPEC-feedback-service` Event stream): a
 * singleton row (`id = 'feedback'`) holding the last dispatched
 * `feedback_event` `seq`. T8 creates the table; T9 (the dispatcher) reads and
 * advances it — only after a broker confirm — and seeds the row on first use.
 *
 * `lastSeq` is typed `string`: pg surfaces `bigint` as a string; it is compared
 * and updated in SQL, never in JS.
 */
@Entity('feedback_cursor')
export class FeedbackCursor {
  @PrimaryColumn({ type: 'text', default: 'feedback' })
  id: string;

  @Column({ type: 'bigint', default: 0 })
  lastSeq: string;
}
