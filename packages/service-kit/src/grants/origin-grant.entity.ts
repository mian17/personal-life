import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Which single origin a producer client may write, shared by every hub
 * (SPEC-todo-origin §9.3, mirroring the `user_keys` shape).
 *
 * One row per OIDC `client_id`: the client is the producer, so it names exactly one
 * `originService`. There is no wildcard column and no second row per client by
 * design — a hub that needs a client to write two origins needs a spec change, not
 * a schema change. Each hub registers this entity in its own database; the table is
 * never central.
 *
 * The row is provisioned out of band, never by a request. `grantedAt` is typed as
 * `Date` for the same portability reason as `UserKeys.createdAt`: sqlite normalises
 * it to `datetime`, Postgres to `timestamp without time zone`, so one entity serves
 * both drivers.
 */
@Entity('origin_grant')
export class OriginGrant {
  /** The OIDC `client_id` of the producer this grant belongs to. */
  @PrimaryColumn({ type: 'text' })
  clientId: string;

  /** The origin service name this client's writes are scoped to. */
  @Column({ type: 'text' })
  originService: string;

  /** When the grant was provisioned. */
  @Column({ type: Date })
  grantedAt: Date;
}
