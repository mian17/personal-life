import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One recorded sitting (`SPEC-meditation-app` §1, §5).
 *
 * The measurable part — when it started and ended, how long it was planned for, how
 * long it actually ran, and whether it reached its planned length — lives in one
 * `content` column as an `enc.v1.` envelope (`@life/crypto`), so at rest and in Redis
 * those numbers are ciphertext (`## Cache Rules`).
 *
 * Two fields stay plaintext because they are what SQL is asked, not content: `day` is
 * the client's own local day, which the window read filters on, and `deletedAt` is the
 * soft-delete stamp every read filters on. A delete sets that stamp and never removes
 * the row (`SPEC-meditation-app` §10.1).
 */
@Entity('meditation_session')
@Index('IDX_meditation_session_owner_day', ['ownerSub', 'day'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'text' })
  day: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
