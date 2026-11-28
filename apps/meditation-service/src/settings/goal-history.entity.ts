import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One daily-goal row per day the owner set one (`SPEC-meditation-app` §1).
 *
 * A goal set for a new day inserts a row and leaves every earlier row alone, so a
 * past day keeps the goal that applied then. A second set for the same day replaces
 * that day's row — the unique index makes "one row per `validFrom`" a database fact
 * rather than a promise. `validFrom` is the client's own `YYYY-MM-DD`, stored as text
 * so the exact calendar day survives and compares lexically; it stays plaintext
 * because a day is already plaintext on the sitting rows and is nobody's private
 * number.
 *
 * `content` is an `enc.v1.` envelope holding `{"minutes": N}`, never a bare number:
 * an owner's numbers are ciphertext at rest and in Redis (`## Cache Rules`), the same
 * rule the settings and sitting rows follow. `ownerSub` is nullable for legacy
 * `ADD COLUMN` safety; every insert stamps the caller's `sub` and every query filters
 * on it.
 */
@Entity('meditation_goal')
@Index('IDX_meditation_goal_owner_valid_from', ['ownerSub', 'validFrom'], { unique: true })
export class GoalHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'text' })
  validFrom: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
