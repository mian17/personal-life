import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tag } from './tag.entity';

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

  @ManyToMany(() => Tag, (tag) => tag.notes, { cascade: true })
  @JoinTable({ name: 'note_tag' })
  tags: Tag[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
