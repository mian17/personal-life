import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Single generic table backing every oidc-provider model (Grant, Session,
 * AuthorizationCode, AccessToken, Interaction, …). The provider owns the payload
 * shape; we store it verbatim as JSON so new fields never need a migration.
 */
@Entity('oidc_payload')
export class OidcPayload {
  /** `${model}:${id}` — mirrors the library's keying so the same id never collides across models. */
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text' })
  model: string;

  @Column({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  payload: string;

  /** Secondary lookup indexes, nullable when the model does not use them. */
  @Index()
  @Column({ type: 'text', nullable: true })
  grantId: string | null;

  @Column({ type: 'text', nullable: true })
  uid: string | null;

  @Column({ type: 'text', nullable: true })
  userCode: string | null;

  /** Unix seconds; null means the provider did not request an expiry. */
  @Index()
  @Column({ type: 'integer', nullable: true })
  expiresAt: number | null;
}
