import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One settings row per owner (`SPEC-meditation-app` §1, §4 assumption 6): the daily
 * goal, the planned sitting length, and the interval-bell configuration.
 *
 * The whole configuration lives in one `content` column as an `enc.v1.` envelope
 * (`@life/crypto`): these numbers are the owner's own, so at rest and in Redis they
 * are ciphertext and nothing else (`## Cache Rules`). The primary key is the owner's
 * `sub`, which makes "one row per owner" a database fact rather than a promise.
 */
@Entity('meditation_settings')
export class Settings {
  @PrimaryColumn({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'text' })
  content: string;
}
