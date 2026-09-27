import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The ecosystem tag registry row (`SPEC-tags-service` Data Model). This table is
 * the **single source of truth for tag names** (MAP M1 — vocabulary
 * centralized); it owns vocabulary only and holds **no association tables** by
 * design. Consumers store integer `TagRef`s and resolve names through this
 * service.
 *
 * - `id` is an integer, `AUTOINCREMENT`-style, and this service is its sole
 *   writer (M2 — existing ids are preserved by the migration).
 * - `name` is an `@life/crypto` `enc.v1.` envelope with AAD
 *   `life.v1|<ownerSub>|tag|name` (byte-identical to note-service's historical
 *   shape, so migration re-encrypts cleanly).
 * - `ownerSub` scopes every row to one identity.
 * - `version` is the kernel concurrency counter (PATCH `expectedVersion`).
 * - Uniqueness is per-owner **case-insensitive at service level**: ciphertext is
 *   non-deterministic, so a DB unique index cannot guard the invariant
 *   (`SPEC-notes-at-rest` precedent) — hence no unique index here.
 */
@Entity('tag')
@Index('IDX_tag_owner_sub', ['ownerSub'])
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  /** `enc.v1` envelope of the tag name. */
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
