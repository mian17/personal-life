import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Todo } from './todo.entity';

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
  @ManyToOne(() => Todo, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'todoId' })
  todo: Todo;
}
