import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One recorded focus block (`SPEC-focus-service` §1, §9.1).
 *
 * The row is the whole record: no start or end timestamps, no completed/aborted
 * flag, and no update or delete column — a block is inserted once and never
 * revised. `date` is the client's own `YYYY-MM-DD`, stored as text so the exact
 * calendar day survives (this service never derives one from its own clock), and
 * `minutes` is already floored to whole minutes by the client.
 *
 * `ownerSub` is nullable so a legacy database can `ADD COLUMN` safely; every insert
 * stamps the caller's `sub`, and every query filters on it.
 */
@Entity('focus_session')
@Index('IDX_focus_session_owner_date', ['ownerSub', 'date'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'text' })
  date: string;

  @Column({ type: 'integer' })
  minutes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
