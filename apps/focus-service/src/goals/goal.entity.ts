import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One daily-goal row per day the owner set one (`SPEC-focus-service` §1).
 *
 * A goal set for a new day inserts a row and leaves every earlier row alone, so a
 * past day keeps re-measuring against the goal that applied then. A second set for
 * the same day replaces that day's row — the unique index makes "one row per
 * `validFrom`" a database fact rather than a promise. `validFrom` is the client's
 * own `YYYY-MM-DD`, stored as text so the exact calendar day survives and compares
 * lexically. `ownerSub` is nullable for legacy `ADD COLUMN` safety; every insert
 * stamps the caller's `sub` and every query filters on it.
 */
@Entity('focus_goal')
@Index('IDX_focus_goal_owner_valid_from', ['ownerSub', 'validFrom'], { unique: true })
export class Goal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'text' })
  validFrom: string;

  @Column({ type: 'integer' })
  minutes: number;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
