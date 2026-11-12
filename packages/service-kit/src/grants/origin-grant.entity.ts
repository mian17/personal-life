import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';

/**
 * One user allowing one producer app to write one origin (`SPEC-todo-origin`
 * §9.3, mirroring the `user_keys` shape).
 *
 * A grant is **per owner**: `(ownerSub, clientId)` is the key, so user A granting
 * `meals` says nothing about user B, and the same producer client may hold a
 * different granted origin for each user. Each hub registers this entity in its
 * own database; the table is never central.
 *
 * The row is provisioned out of band by `scripts/grant-origin.ts`, never by a
 * request. `grantedAt` is typed as `Date` for the same portability reason as
 * `UserKeys.createdAt`: sqlite normalises it to `datetime`, Postgres to
 * `timestamp without time zone`, so one entity serves both drivers.
 */
@Entity('origin_grant')
// The composite primary key IS the uniqueness rule; the named constraint carries
// the documented name so the DDL and the spec agree (and the CLI's upsert targets
// exactly one key).
@Unique('UQ_origin_grant_owner_client', ['ownerSub', 'clientId'])
export class OriginGrant {
  /** The OIDC `sub` of the user this grant belongs to. */
  @PrimaryColumn({ type: 'text' })
  ownerSub: string;

  /** The OIDC `client_id` of the producer app that user granted. */
  @PrimaryColumn({ type: 'text' })
  clientId: string;

  /** The origin service name this app's writes are scoped to for this user. */
  @Column({ type: 'text' })
  originService: string;

  /** When the grant was provisioned. */
  @Column({ type: Date })
  grantedAt: Date;
}
