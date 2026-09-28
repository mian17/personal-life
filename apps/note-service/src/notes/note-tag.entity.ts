import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Note } from './note.entity';

/**
 * Association-only join row for `SPEC-tags-extraction`: note-service stores
 * **only** the integer `tagId`s a write carried (`TagRef`) — tag names live
 * solely in `tags-service` (MAP M1/M4).
 *
 * The table is the historical `note_tag`, kept in place so the migration moves
 * no association values. `noteId` keeps its `ON DELETE CASCADE` FK to `note`
 * (deleting a note removes its associations); `tagId` is a plain integer with
 * **no FK** — the referenced vocabulary is external (cross-DB referential
 * integrity is service-level detach semantics, not a DB constraint).
 *
 * The generated DDL is byte-for-byte what `apps/tags-service/src/tags/import.ts`
 * rebuilds during schema surgery, so a post-migration boot's `synchronize`
 * performs zero schema-mutating statements (`SPEC-owner-backfill` precedent).
 */
@Entity('note_tag')
export class NoteTag {
  @PrimaryColumn({ type: 'varchar' })
  noteId: string;

  @PrimaryColumn({ type: 'integer' })
  tagId: number;

  @ManyToOne(() => Note, (note) => note.noteTags, {
    onDelete: 'CASCADE',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'noteId' })
  note: Note;
}
