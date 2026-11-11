import type { ClientMetadata } from 'oidc-provider';

/**
 * Static client registry (no dynamic registration). Only the authorization code
 * flow with PKCE S256 is offered; both clients require PKCE.
 *
 * `id_token_signed_response_alg: 'EdDSA'` because our keystore is Ed25519-only —
 * the library default (RS256) would reject the client at authorization time.
 */

const DEV_REDIRECT_URIS = ['http://127.0.0.1:8080/cb', 'http://localhost:8080/cb'];
/** Default callback registered in production (behind Tailscale Serve on :3002). */
const PROD_APP_REDIRECT_URI = 'http://127.0.0.1:3002/auth/callback';
/**
 * Dev default. The app canonicalizes a loopback redirect to `localhost` (the
 * host Next's middleware puts the browser on — see `apps/app/lib/auth/origin.ts`),
 * and a hand-run setup may still send either spelling, so register both. The
 * port matches the app's dev port (3000).
 */
const DEV_APP_REDIRECT_URIS = [
  'http://localhost:3000/auth/callback',
  'http://127.0.0.1:3000/auth/callback',
];

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
    throw new Error('OIDC_APP_CLIENT_SECRET must be set in production (no placeholder fallback)');
  }
  return DEV_APP_CLIENT_SECRET;
}

/**
 * Registered redirect URIs for the `app` client. Explicit `OIDC_APP_REDIRECT_URIS`
 * always wins. Otherwise the default follows the environment so the browser URL
 * matches with zero config: dev registers both loopback spellings on :3000 (the
 * app canonicalizes to `localhost`; a hand-run setup may use `127.0.0.1`),
 * production → :3002. The exact string must match the browser URL and the app's
 * `OIDC_APP_REDIRECT_URI`.
 */
function appRedirectUris(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OIDC_APP_REDIRECT_URIS?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return env.NODE_ENV === 'production' ? [PROD_APP_REDIRECT_URI] : [...DEV_APP_REDIRECT_URIS];
}

const CODE_CLIENT = {
  grant_types: ['authorization_code', 'refresh_token'] as const,
  response_types: ['code'] as const,
  scope: 'openid',
  id_token_signed_response_alg: 'EdDSA' as const,
};

/**
 * The producer clients the acceptance sequence exercises: one granted, one
 * deliberately ungranted. They are listed here rather than derived because a
 * producer is a known deployment, and the grant table keys off these ids.
 */
const PRODUCER_CLIENT_IDS = ['producer-a', 'producer-b'] as const;

/**
 * Producer callbacks are loopback-only and their ports come from the producer
 * app, so each client registers under its own
 * `OIDC_PRODUCER_<NAME>_REDIRECT_URIS`. Production must supply it, mirroring
 * `OIDC_APP_REDIRECT_URIS`: a boot that forgot a producer's callback fails
 * loudly instead of registering a client nobody can reach.
 */
function producerRedirectUris(producerName: string, env: NodeJS.ProcessEnv): string[] {
  const setting = `OIDC_PRODUCER_${producerName.toUpperCase().replaceAll('-', '_')}_REDIRECT_URIS`;
  const registered = env[setting]?.trim();
  if (registered) {
    return registered
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(`${setting} must be set in production (no placeholder callback)`);
  }
  return [...DEV_REDIRECT_URIS];
}

/**
 * A producer app runs on the user's machine, so its client is public: no secret,
 * and PKCE is the only proof it can give.
 */
function producerClient(producerName: (typeof PRODUCER_CLIENT_IDS)[number]): ClientMetadata {
  return {
    ...CODE_CLIENT,
    client_id: producerName,
    client_name: `producer ${producerName}`,
    token_endpoint_auth_method: 'none',
    redirect_uris: producerRedirectUris(producerName, process.env),
  };
}

/**
 * The `app` relying party. Confidential, authenticates with
 * `client_secret_basic`; the secret comes from `OIDC_APP_CLIENT_SECRET` and is
 * never logged. Required in production (see `resolveAppClientSecret`).
 */
export function appClient(env: NodeJS.ProcessEnv = process.env): ClientMetadata {
  return {
    ...CODE_CLIENT,
    client_id: 'app',
    client_name: 'personal-life app',
    client_secret: resolveAppClientSecret(env),
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: appRedirectUris(env),
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
  return [appClient(), devClient(), ...PRODUCER_CLIENT_IDS.map(producerClient)];
}
