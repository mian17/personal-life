import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A todo-local list (`SPEC-todo-service` Data model). Lists are todo-local by
 * intent (I4) and never surface in the notes app.
 *
 * - `id` is a service-generated UUID v4.
 * - `name` is an `@life/crypto` `enc.v1.` envelope with AAD
 *   `life.v1|<sub>|list|name|<id>`.
 * - `version` is the kernel concurrency counter (PATCH `expectedVersion`).
 * - Uniqueness of names is per-owner **case-insensitive at service level**:
 *   ciphertext is non-deterministic, so a DB unique index cannot guard the
 *   invariant (`SPEC-notes-at-rest` precedent) — no unique index here.
 * - Deleting a list detaches its todos (`todo.listId` `ON DELETE SET NULL`);
 *   the todos survive.
 */
@Entity('list')
@Index('IDX_list_owner_sub', ['ownerSub'])
export class List {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `enc.v1` envelope of the list name. */
  @Column({ type: 'text' })
  name: string;

  /**
   * Plaintext metadata: default importance for the list's todos
   * (`SPEC-todo-importance`). Non-content, never encrypted. `NULL` = false.
   */
  @Column({ type: 'boolean', nullable: true })
  importantDefault: boolean | null;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
