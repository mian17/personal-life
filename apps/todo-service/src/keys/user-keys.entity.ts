import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Per-owner data-encryption key registry for todo-service
 * (`SPEC-todo-service` key custody, mirroring `SPEC-notes-at-rest` Data Model).
 *
 * One row per `sub`; `wrappedDek` is a `kw.v1.<nonce>.<ct>` envelope produced by
 * `@life/crypto` under the process master key (`TODO_MASTER_KEY`). The raw DEK
 * never lands in this table, in logs, or in error messages. `createdAt` is set
 * by the service on insert (not a DB default) so the column shape stays explicit
 * and portable.
 *
 * This service's key custody is **independent** of note-service's and
 * tags-service's: the todo DEKs are derived from `TODO_MASTER_KEY`, so the
 * stores never share a KEK.
 */
@Entity('user_keys')
export class UserKeys {
  /** Owner sub; opaque to this service. */
  @PrimaryColumn({ type: 'text' })
  sub: string;

  /** `kw.v1` envelope of the owner's 256-bit DEK. */
  @Column({ type: 'text' })
  wrappedDek: string;

  /** Bumped by a future rotate-master-key flow when the KEK changes. */
  @Column({ type: 'integer', default: 1 })
  kekVersion: number;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
