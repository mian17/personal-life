/**
 * Environment for the app's OIDC relying-party client. No tokens live here, so
 * this module is intentionally not `server-only` — it is safe to unit test and
 * to import from either environment.
 *
 * Dev notes:
 * - `IDP_ISSUER` defaults to the local IdP (http://127.0.0.1:3003).
 * - `OIDC_APP_REDIRECT_URI` defaults to the IdP-registered app redirect
 *   (http://127.0.0.1:3002/auth/callback, the production web port). Dev runs on
 *   port 3000, so set it to http://127.0.0.1:3000/auth/callback for local dev.
 * - `OIDC_APP_CLIENT_SECRET` has no default and must be supplied (see
 *   apps/idp/src/oidc/clients.ts — the IdP falls back to an obviously-fake
 *   placeholder while the RP ships dark; use that in dev).
 */

export interface AuthEnv {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** RFC 8707 resource indicator sent on the authorization and token requests. */
  resource: string;
}

export function getIdpIssuer(env: NodeJS.ProcessEnv = process.env): string {
  return env.IDP_ISSUER ?? 'http://127.0.0.1:3003';
}

export function getAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const clientSecret = env.OIDC_APP_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error('OIDC_APP_CLIENT_SECRET is not set');
  }
  return {
    issuer: getIdpIssuer(env),
    clientId: env.OIDC_APP_CLIENT_ID ?? 'app',
    clientSecret,
    redirectUri: env.OIDC_APP_REDIRECT_URI ?? 'http://127.0.0.1:3002/auth/callback',
    resource: env.OIDC_APP_RESOURCE ?? 'https://note-service',
  };
}

/** True when the issuer is plain http (local dev); `openid-client` needs an opt-in then. */
export function issuerAllowsInsecure(issuer: string): boolean {
  try {
    return new URL(issuer).protocol === 'http:';
  } catch {
    return false;
  }
}
