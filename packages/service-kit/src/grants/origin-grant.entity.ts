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
 * Two writers, and only two: the operator CLI `scripts/grant-origin.ts`, which
 * provisions a grant for someone else from three flags, and `GrantsService.grantOwn`,
 * which a hub's own route calls when the user turns a producer on from that
 * producer's settings screen (`SPEC-todo-origin` assumption 12).
 *
 * The consent columns are nullable **on purpose**, and the asymmetry is the point:
 * a CLI-provisioned grant predates consent capture — the operator provisioning
 * `(someoneElse, producer-a)` has no sentence to quote — while every grant written
 * by the route carries both values, because the route exists only to record a
 * consent the screen just showed. A nullable column therefore cannot be read as
 * "the user agreed to nothing": absent means "not captured", never "declined".
 *
 * `grantedAt` is typed as `Date` for the same portability reason as
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

  /**
   * The sentence shown when the grant was granted, verbatim, or `null` for a grant
   * an operator provisioned without a consent screen (`MEAL_TODO_DISCLOSURE`).
   */
  @Column({ type: 'text', nullable: true })
  disclosure: string | null;

  /** sha256 hex of `disclosure`, so a re-worded sentence is detectable. */
  @Column({ type: 'text', nullable: true })
  disclosureHash: string | null;
}
