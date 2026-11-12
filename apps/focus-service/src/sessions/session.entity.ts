import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One recorded focus block (`SPEC-focus-service` §1, §9.1).
 *
 * The row is the whole record: no start or end timestamps, no completed/aborted
 * flag. `date` is the client's own `YYYY-MM-DD`, stored as text so the exact
 * calendar day survives (this service never derives one from its own clock), and
 * `minutes` is already floored to whole minutes by the client.
 *
 * A block is inserted once. The one thing written afterwards is *whether the owner
 * answered the question its `todoId` raised* — the block's minutes are never revised
 * and the row is never deleted.
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

  /**
   * The task this block worked on, recorded as todo-service's id and nothing else.
   *
   * A **soft reference**: the task lives in todo-service's own database, so there is
   * no foreign key to declare and nothing to join. Deliberately no copied content —
   * no title, no due date, no done flag — because a copy would be a second source of
   * truth that rots the moment the owner edits the task in the app that owns it. A
   * reader resolves the id against todo-service, always.
   */
  @Column({ type: 'text', nullable: true })
  todoId: string | null;

  /**
   * When the owner answered the "done?" question `todoId` raised; `null` on a block
   * that named a task means the question is still owed.
   *
   * Stored, not inferred: a block recorded in a tab that then closed still has its
   * question asked on the next load, because the question is a fact about this row
   * rather than about the client moment that recorded it. Both answers — ticked or
   * not yet — write it, so the question is asked once.
   */
  @Column({ type: 'datetime', nullable: true })
  todoAnsweredAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
