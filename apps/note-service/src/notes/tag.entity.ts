import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Note } from './note.entity';

// `tag.name` is now an `@life/crypto` envelope (non-deterministic), so the former
// `UQ_tag_name_owner` unique index can no longer guard the `(name, ownerSub)`
// invariant. `SPEC-notes-at-rest` relocates it to case-insensitive service-level
// dedupe (`NotesService.resolveTags`); `notes-backfill` drops the physical index.
@Entity('tag')
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  name: string;

  // Nullable so a legacy DB can `ALTER TABLE ADD COLUMN` safely; NULL rows are
  // legacy pre-boundary tags, matched by no query and written only by the
  // owner-backfill script. Every `create` stamps the caller's `sub` here, and
  // uniqueness is per `(name, ownerSub)` so two users may own the same name.
  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @ManyToMany(() => Note, (note) => note.tags)
  notes: Note[];
}
