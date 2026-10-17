import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NoteTag } from './note-tag.entity';

@Entity('note')
@Index('IDX_note_owner_sub', ['ownerSub'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  body: string;

  // Nullable so a legacy DB can `ALTER TABLE ADD COLUMN` safely; NULL rows are
  // legacy pre-boundary notes, matched by no query and written only by the
  // owner-backfill script. Every `create` stamps the caller's `sub` here.
  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  // Nullable so a legacy DB can `ALTER TABLE ADD COLUMN` safely; NULL rows are
  // pre-deploy notes, read as `createdAt` until the human-run backfill runs.
  // Bumped only by body writes (NotesService.update on `body`), never by
  // retag/trash/restore.
  @Column({ type: 'datetime', nullable: true })
  contentUpdatedAt: Date | null;

  // Association-only (TagRefs by id). note-service owns no tag vocabulary;
  // tag names live in `tags-service` (SPEC-tags-extraction). The join rows are
  // managed explicitly by `NotesService` (replace-the-set on writes).
  @OneToMany(() => NoteTag, (noteTag) => noteTag.note)
  noteTags: NoteTag[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
