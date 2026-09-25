import { Column, Entity, Index, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Note } from './note.entity';

@Entity('tag')
@Index('UQ_tag_name_owner', ['name', 'ownerSub'], { unique: true })
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
