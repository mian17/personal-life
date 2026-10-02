import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * A stored Web Push subscription (`SPEC-todo-service` push surface). One row per
 * `(owner, endpoint)`: the endpoint identifies a browser push channel, `p256dh`
 * and `auth` are the client's public key material for payload encryption. The
 * subscription carries no todo content — it is delivery capability only, so it
 * is deliberately **outside the cache** (Contract 2).
 *
 * - `id` is a service-generated UUID v4.
 * - `@Unique(['ownerSub', 'endpoint'])` is composite on purpose: a global
 *   endpoint unique would let a foreign `sub` upsert over another owner's row.
 *   Uniqueness is scoped to the owner; a second caller can never overwrite it.
 */
@Entity('push_subscription')
@Index('IDX_push_subscription_owner_sub', ['ownerSub'])
@Unique('UQ_push_subscription_owner_endpoint', ['ownerSub', 'endpoint'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  ownerSub: string;

  @Column({ type: 'text' })
  endpoint: string;

  /** Client public key (base64url) for Web Push payload encryption. */
  @Column({ type: 'text' })
  p256dh: string;

  /** Client auth secret (base64url) for Web Push payload encryption. */
  @Column({ type: 'text' })
  auth: string;

  @Column({ type: 'datetime' })
  createdAt: Date;
}
