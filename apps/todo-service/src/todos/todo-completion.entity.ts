import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Todo } from './todo.entity.js';

@Entity('todo_completion')
@Unique('UQ_todo_completion_todo_occurrence', ['todoId', 'occurrence'])
@Index('IDX_todo_completion_owner_completed', ['ownerSub', 'completedAt'])
@Index('IDX_todo_completion_todo', ['todoId', 'completedAt'])
export class TodoCompletion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) ownerSub: string;
  @Column({ type: 'text' }) todoId: string;
  @Column({ type: 'text' }) occurrence: string;
  @Column({ type: 'text' }) completedAt: string;
  /**
   * The title as it read when this occurrence was still OPEN, sealed exactly as
   * `todo.title` is (`enc.v1.` envelope, same AAD). `NULL` means "no rename has
   * happened since this occurrence was logged", so a reader falls back to the live
   * title — which is correct, because a completion logged after a rename genuinely
   * happened at the new number.
   *
   * The snapshot is written by the **rename**, never by the tick: a rename is the
   * only act that can falsify history, and it is the only act that knows the old
   * text is about to disappear. Keeping the tick path silent is why a tick still
   * writes one bare row and the UNIQUE-dedup contract is untouched.
   */
  @Column({ type: 'text', nullable: true }) title: string | null;
  @ManyToOne(() => Todo, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'todoId' })
  todo: Todo;
}
