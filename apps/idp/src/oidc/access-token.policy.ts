import type { ResourceServer } from 'oidc-provider';

/** Access-token lifetime: 10 minutes (recorded decision, aligned with the refresh policy). */
export const ACCESS_TOKEN_TTL_S = 600;

/** The claims our access tokens carry; `aud` scopes the token to one target service. */
export interface AccessTokenClaims {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
}

function epochSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}

/**
 * Audience for a target service. A plain service name (`note-service`) is used
 * as-is; an absolute resource URI (`https://note-service/api`) contributes its
 * host. The full scope→audience client mapping is Task 5's job.
 */
export function audienceFor(resource: string): string {
  const value = resource.trim();
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

/** The canonical claim shape for an audience-scoped access token. */
export function accessTokenClaims(
  subject: string,
  audience: string,
  now: number = epochSeconds(),
): AccessTokenClaims {
  return { sub: subject, aud: audience, iat: now, exp: now + ACCESS_TOKEN_TTL_S };
}

/**
 * Provider resource-server policy: JWT-format access tokens signed with our
 * Ed25519 keystore, 10-minute TTL, audience scoped to the target service.
 * Scopes are validated against the client's registered scope in Task 5.
 */
export function resourceServerPolicy(resource: string): ResourceServer {
  return {
    scope: 'openid',
    audience: audienceFor(resource),
    accessTokenTTL: ACCESS_TOKEN_TTL_S,
    accessTokenFormat: 'jwt',
    jwt: { sign: { alg: 'EdDSA' } },
  };
}
