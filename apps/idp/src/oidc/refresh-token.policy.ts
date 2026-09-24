import type { Client, KoaContextWithOIDC } from 'oidc-provider';

/** Refresh-token lifetime: 30 days (recorded decision). */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

/** Sessions and grants must outlive the 30-day refresh token (see below). */
export const SESSION_TTL_S = 30 * 24 * 60 * 60;
export const GRANT_TTL_S = 30 * 24 * 60 * 60;

/**
 * Issue refresh tokens to any client allowed the `refresh_token` grant.
 *
 * The library default also requires the `offline_access` scope, but we removed
 * the `consent` prompt (single-user IdP), and the provider strips
 * `offline_access` when there is no consent prompt — so relying on that scope
 * would never issue a token. Scoping on the grant keeps issuance explicit:
 * only the code+PKCE clients that opted into `refresh_token` get one.
 */
export function issueRefreshToken(_ctx: KoaContextWithOIDC, client: Client): boolean {
  return client.grantTypeAllowed('refresh_token');
}

/**
 * Rotate on every use. `true` (rather than the default heuristic function)
 * matches the recorded decision exactly: every successful refresh returns a new
 * refresh token with a fresh 30-day TTL, the presented token is consumed, and
 * presenting a consumed token fails and revokes the whole grant family
 * (handled by the library's refresh_token grant).
 */
export const ROTATE_REFRESH_TOKEN = true;

/**
 * Do not bind opaque tokens to the provider session. The default binds them when
 * `offline_access` is absent, which would cap their life at `ttl.Session`; we
 * want the refresh token to live its full 30 days, independent of the session.
 */
export function expiresWithSession(): boolean {
  return false;
}

