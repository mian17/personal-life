import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Per-owner data-encryption key registry (`SPEC-notes-at-rest` Data Model).
 *
 * One row per `sub`; `wrappedDek` is a `kw.v1.<nonce>.<ct>` envelope produced by
 * `@life/crypto` under the process master key. The raw DEK never lands in this
 * table, in logs, or in error messages. `createdAt` is set by the service on
 * insert (not a DB default) so the column shape stays explicit and portable.
 */
@Entity('user_keys')
export class UserKeys {
  /** Owner sub; `_legacy_` is the caller's sentinel for NULL-owner rows. */
  @PrimaryColumn({ type: 'text' })
  sub: string;

  /** `kw.v1` envelope of the owner's 256-bit DEK. */
  @Column({ type: 'text' })
  wrappedDek: string;

  /** Bumped by the rotate-master-key script when the KEK changes. */
  @Column({ type: 'integer', default: 1 })
  kekVersion: number;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
