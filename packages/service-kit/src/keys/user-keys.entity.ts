import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Per-owner data-encryption key registry, shared by every service that stores
 * content at rest (Contract 2, mirroring `SPEC-notes-at-rest` Data Model).
 *
 * One row per `sub`; `wrappedDek` is the `kw.v1.<nonce>.<ct>` envelope produced by
 * `@life/crypto` under the process master key. The raw DEK never lands in the
 * table, in logs, or in error messages. `createdAt` is set by the service on
 * insert (not a DB default) so the column shape stays explicit and portable.
 *
 * Each service's key custody is independent: DEKs are derived from that
 * service's own master key (`<SERVICE>_MASTER_KEY`), so two stores never share a
 * KEK even though they share this table shape. That shared table name also means
 * one file can serve them all — there is no per-service column difference.
 */
@Entity('user_keys')
export class UserKeys {
  /** Owner sub; opaque to the service. */
  @PrimaryColumn({ type: 'text' })
  sub: string;

  /** `kw.v1` envelope of the owner's 256-bit DEK. */
  @Column({ type: 'text' })
  wrappedDek: string;

  /** Bumped by a future rotate-master-key flow when the KEK changes. */
  @Column({ type: 'integer', default: 1 })
  kekVersion: number;

  /**
   * When the row was created. Typed as `Date` (not a driver literal) so the one
   * entity works on both drivers in this repo: sqlite normalises `Date` to
   * `datetime`, Postgres to `timestamp without time zone`. A literal like
   * `datetime` is sqlite-only and `timestamptz` is Postgres-only, so either one
   * would break the other services that share this entity.
   */
  @Column({ type: Date })
  createdAt: Date;
}
