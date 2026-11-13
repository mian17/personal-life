import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';

/**
 * One user allowing one producer app one capability — write one origin, or read
 * their tasks (`SPEC-todo-origin` §9.3, mirroring the `user_keys` shape).
 *
 * A grant is **per owner**: `(ownerSub, clientId, direction)` is the key, so user A
 * granting `meals` says nothing about user B, and the same producer client may hold
 * a different granted origin for each user. Each hub registers this entity in its
 * own database; the table is never central.
 *
 * `direction` is part of the key, not merely a column, and that is load-bearing:
 * the BFF presents the **same** `client_id` (`app`) for every app it proxies, so
 * meals and focus hold rows for the identical `(ownerSub, clientId)` pair. With a
 * two-column key the focus read grant would overwrite the meals write grant and
 * meals would silently stop being able to write — a regression no existing test
 * would catch (`grants.service.test.ts` grants both and asserts two rows).
 *
 * `scope` narrows a **read** grant and is `null` for a write grant, because a write
 * grant is already scoped by `originService`. `'all'` lets the consumer pick from
 * every open task of the owner; `'own-origin'` limits it to rows this producer
 * created. The route that writes a grant decides both values from the origin, never
 * from the body — a body that could name its own scope would re-open the escalation
 * hole closed for `clientId`.
 *
 * Two writers, and only two: the operator CLI `scripts/grant-origin.ts`, which
 * provisions a grant for someone else from flags, and `GrantsService.grantOwn`,
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
@Unique('UQ_origin_grant_owner_client_direction', ['ownerSub', 'clientId', 'direction'])
export class OriginGrant {
  /** The OIDC `sub` of the user this grant belongs to. */
  @PrimaryColumn({ type: 'text' })
  ownerSub: string;

  /** The OIDC `client_id` of the producer app that user granted. */
  @PrimaryColumn({ type: 'text' })
  clientId: string;

  /**
   * What the grant allows: `'write'` (create and tick origin todos) or `'read'`
   * (list the owner's tasks). Defaults to `'write'`, so every row written before
   * this column existed is a write grant and every write path keeps seeing it.
   */
  @PrimaryColumn({ type: 'text', default: 'write' })
  direction: GrantDirection;

  /** The origin service name this app's writes are scoped to for this user. */
  @Column({ type: 'text' })
  originService: string;

  /**
   * How far a **read** grant reaches: `'all'` (every open task of the owner) or
   * `'own-origin'` (only rows this producer created). `null` for a write grant,
   * which is already scoped by `originService`.
   */
  @Column({ type: 'text', nullable: true })
  scope: GrantScope | null;

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

/**
 * The closed set of grant directions. A text column, not a Postgres enum: the
 * driver is sqlite and the set is small enough that a `CHECK` would be the only
 * thing an enum bought, so `GRANT_DIRECTIONS` is the one owner of the words.
 */
export const GRANT_DIRECTIONS = ['write', 'read'] as const;

export type GrantDirection = (typeof GRANT_DIRECTIONS)[number];

/** The closed set of read scopes — meaningless for a write grant, which is `null`. */
export const GRANT_SCOPES = ['own-origin', 'all'] as const;

export type GrantScope = (typeof GRANT_SCOPES)[number];
