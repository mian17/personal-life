import type { ResourceServer } from 'oidc-provider';

/** Access-token lifetime: 10 minutes (recorded decision, aligned with the refresh policy). */
export const ACCESS_TOKEN_TTL_S = 600;

/**
 * Resource indicator used when a client does not send `resource` explicitly.
 * Resource indicators must be absolute URIs; the audience (`aud`) is resolved by
 * `audienceFor`. Configurable (`OIDC_DEFAULT_RESOURCE`) so `todo-service` can be
 * added later; defaults to the notes API.
 */
export function defaultResource(): string {
  return process.env.OIDC_DEFAULT_RESOURCE?.trim() || 'https://note-service';
}

/**
 * Resource-indicator → audience mapping, as a comma-separated `resource=audience`
 * list (`OIDC_AUDIENCE_MAP`). Defaults preserve the current behaviour:
 * `https://note-service=note-service`. Unmapped resources fall back to the
 * resource URI's hostname.
 */
function audienceMap(): Map<string, string> {
  const raw = process.env.OIDC_AUDIENCE_MAP?.trim() || 'https://note-service=note-service';
  const map = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const resource = trimmed.slice(0, eq).trim();
    const audience = trimmed.slice(eq + 1).trim();
    if (resource && audience) map.set(resource, audience);
  }
  return map;
}

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
 * Audience for a target service. An explicit mapping (see `OIDC_AUDIENCE_MAP`)
 * wins; otherwise a plain service name (`note-service`) is used as-is and an
 * absolute resource URI (`https://note-service/api`) contributes its hostname.
 */
export function audienceFor(resource: string): string {
  const value = resource.trim();
  const mapped = audienceMap().get(value);
  if (mapped) return mapped;
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
