import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TodoRepeat } from '@life/shared';
import { List } from '../lists/list.entity.js';
import { TodoTag } from './todo-tag.entity.js';

/**
 * The todo row (`SPEC-todo-service` Data model). Content fields (`title`,
 * `note`) are `@life/crypto` `enc.v1.` envelopes with the AADs
 * `life.v1|<sub>|todo|title|<id>` and `life.v1|<sub>|todo|note|<id>`. Metadata
 * columns (`done`, `dueDate`, `listId`, timestamps) stay plaintext and queryable
 * in SQL — `dueDate` is operational data, not content (recorded in the spec).
 *
 * - `id` is a service-generated UUID v4; the AAD binds it, so it exists before
 *   the ciphertext is produced.
 * - `listId` has `ON DELETE SET NULL`: deleting a list detaches its todos
 *   (they survive), which is the domain's detach semantics.
 * - `origin` is the reserved orchestrator-seam column (`SPEC-service-kernel`);
 *   nullable JSON `{service,id}`, nothing populates it in this chapter.
 * - `todo_tag` rows are association-only TagRefs (ids, no names) managed
 *   explicitly by `TodosService` (writes replace the set).
 */
@Entity('todo')
@Index('IDX_todo_owner_sub', ['ownerSub'])
@Index('IDX_todo_reminder_scheduled_at', ['reminderScheduledAt'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `enc.v1` envelope of the title. */
  @Column({ type: 'text' })
  title: string;

  /** `enc.v1` envelope of the optional note; `NULL` = notes-less todo. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  /**
   * Plaintext metadata: manual importance override (`SPEC-todo-importance`).
   * Non-content — never `@life/crypto`-wrapped (mirrors `done`). `NULL` =
   * inherit the todo's list default.
   */
  @Column({ type: 'boolean', nullable: true })
  important: boolean | null;

  /**
   * Plaintext metadata: either `YYYY-MM-DD` (date-only) or a canonical
   * `…Z` UTC instant (timed). Stored as `TEXT` so both shapes round-trip as
   * strings and the date-only value never passes through `Date` (lesson 0003).
   */
  @Column({ type: 'text', nullable: true })
  dueDate: string | null;

  /** Plaintext metadata: recurrence rule (`SPEC-todo-service`). `NULL` = one-off. */
  @Column({ type: 'text', nullable: true })
  repeat: TodoRepeat | null;

  /**
   * Plaintext metadata: custom recurrence weekday set as a CSV of ISO weekdays
   * (`'4,5'`), or `NULL` for a canned repeat/one-off. Non-content, never
   * encrypted, never in the cache key (`SPEC-todo-custom-repeat`, D1/D2).
   */
  @Column({ type: 'text', nullable: true })
  repeatDays: string | null;

  /** Plaintext metadata: server-computed UTC instant the next push fires at. */
  @Column({ type: 'text', nullable: true })
  reminderScheduledAt: string | null;

  @Column({ type: 'text', nullable: true })
  listId: string | null;

  /** Reserved orchestrator seam: JSON `{service,id}`. Unused this chapter. */
  @Column({ type: 'text', nullable: true })
  origin: string | null;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime' })
  createdAt: Date;

  @Column({ type: 'datetime' })
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  // Association-only (TagRefs by id). todo-service owns no tag vocabulary; tag
  // names live in `tags-service`. Join rows are managed explicitly by the
  // service (replace-the-set on writes).
  @OneToMany(() => TodoTag, (todoTag) => todoTag.todo)
  todoTags: TodoTag[];

  @ManyToOne(() => List, { onDelete: 'SET NULL', onUpdate: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'listId' })
  list: List | null;
}
