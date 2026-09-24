import type { ClientMetadata } from 'oidc-provider';

/**
 * Static client registry (no dynamic registration). Only the authorization code
 * flow with PKCE S256 is offered; both clients require PKCE.
 *
 * `id_token_signed_response_alg: 'EdDSA'` because our keystore is Ed25519-only —
 * the library default (RS256) would reject the client at authorization time.
 */

const DEV_REDIRECT_URIS = ['http://127.0.0.1:8080/cb', 'http://localhost:8080/cb'];
const DEFAULT_APP_REDIRECT_URIS = ['http://127.0.0.1:3002/auth/callback'];

/**
 * Obviously-fake placeholder used only when `OIDC_APP_CLIENT_SECRET` is unset.
 * The `app` client ships dark until Task 7, so a real secret is not needed yet;
 * production MUST supply `OIDC_APP_CLIENT_SECRET` before the RP is switched on.
 */
const DEV_APP_CLIENT_SECRET = 'app-dev-client-secret-not-a-secret';

function envList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [...fallback];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const CODE_CLIENT = {
  grant_types: ['authorization_code'] as const,
  response_types: ['code'] as const,
  scope: 'openid',
  id_token_signed_response_alg: 'EdDSA' as const,
};

/**
 * The `app` relying party (Task 7). Confidential, authenticates with
 * `client_secret_basic`; the secret comes from `OIDC_APP_CLIENT_SECRET` and is
 * never logged. Falls back to an obviously-fake placeholder while dark.
 */
export function appClient(): ClientMetadata {
  return {
    ...CODE_CLIENT,
    client_id: 'app',
    client_name: 'personal-life app',
    client_secret: process.env.OIDC_APP_CLIENT_SECRET?.trim() || DEV_APP_CLIENT_SECRET,
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: envList('OIDC_APP_REDIRECT_URIS', DEFAULT_APP_REDIRECT_URIS),
  };
}

/** Public client for tests and throwaway scripts; no secret, PKCE still required. */
export function devClient(): ClientMetadata {
  return {
    ...CODE_CLIENT,
    client_id: 'dev',
    client_name: 'dev (tests and scripts)',
    token_endpoint_auth_method: 'none',
    redirect_uris: [...DEV_REDIRECT_URIS],
  };
}

export function staticClients(): ClientMetadata[] {
  return [appClient(), devClient()];
}
