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
 * Obviously-fake placeholder used only outside production. Production MUST
 * supply `OIDC_APP_CLIENT_SECRET` — `resolveAppClientSecret` throws otherwise,
 * so a misconfigured production boot fails loudly rather than shipping a
 * known-public secret.
 */
const DEV_APP_CLIENT_SECRET = 'app-dev-client-secret-not-a-secret';

/**
 * The `app` client secret. Required in production (fails loudly); an
 * obviously-fake default is allowed in development/test only.
 */
export function resolveAppClientSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.OIDC_APP_CLIENT_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'OIDC_APP_CLIENT_SECRET must be set in production (no placeholder fallback)',
    );
  }
  return DEV_APP_CLIENT_SECRET;
}

function envList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [...fallback];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const CODE_CLIENT = {
  grant_types: ['authorization_code', 'refresh_token'] as const,
  response_types: ['code'] as const,
  scope: 'openid',
  id_token_signed_response_alg: 'EdDSA' as const,
};

/**
 * The `app` relying party. Confidential, authenticates with
 * `client_secret_basic`; the secret comes from `OIDC_APP_CLIENT_SECRET` and is
 * never logged. Required in production (see `resolveAppClientSecret`).
 */
export function appClient(): ClientMetadata {
  return {
    ...CODE_CLIENT,
    client_id: 'app',
    client_name: 'personal-life app',
    client_secret: resolveAppClientSecret(),
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

/**
 * Asserts production-critical OIDC config at boot. Kept separate from
 * `staticClients()` so it runs even though the provider itself is built lazily:
 * a production boot without the app client secret must fail immediately rather
 * than on the first authorization request.
 */
export function assertOidcConfig(env: NodeJS.ProcessEnv = process.env): void {
  resolveAppClientSecret(env);
}

export function staticClients(): ClientMetadata[] {
  return [appClient(), devClient()];
}
