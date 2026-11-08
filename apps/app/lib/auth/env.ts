/**
 * Environment for the app's OIDC relying-party client. No tokens live here, so
 * this module is intentionally not `server-only` — it is safe to unit test and
 * to import from either environment.
 *
 * Dev notes:
 * - `IDP_ISSUER` defaults to the local IdP (http://127.0.0.1:3003).
 * - `OIDC_APP_REDIRECT_URI` must be byte-identical to the browser URL *and* to an
 *   entry in the IdP's `OIDC_APP_REDIRECT_URIS`. Dev runs on port 3000, so set
 *   it to http://127.0.0.1:3000/auth/callback locally.
 * - `OIDC_APP_CLIENT_SECRET` is REQUIRED in production (no fallback); outside
 *   production an obviously-fake default is used so dev/test boot without it.
 */

import { canonicalizeLoopbackUrl } from './origin';

export interface AuthEnv {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** RFC 8707 resource indicator sent on the authorization and token requests. */
  resource: string;
}

/** A minimal env bag, so callers/tests can pass plain objects (not the global ProcessEnv). */
export type AuthEnvSource = Record<string, string | undefined>;

/** Obviously-fake secret allowed only outside production (mirrors the IdP side). */
const DEV_APP_CLIENT_SECRET = 'app-dev-client-secret-not-a-secret';

/** The one callback path this app serves; the redirect URI must point at it. */
export const CALLBACK_PATH = '/auth/callback';

export function getIdpIssuer(env: AuthEnvSource = process.env): string {
  return env.IDP_ISSUER ?? 'http://127.0.0.1:3003';
}

function requireAbsoluteUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL, got "${value}"`);
  }
  if (!url.protocol || !url.host) {
    throw new Error(`${name} must be an absolute URL, got "${value}"`);
  }
  return url;
}

/**
 * Validates the OIDC config at load time. Throws on anything that would break
 * the dance (non-absolute URLs, a redirect URI that is not this app's callback),
 * so a misconfigured production boot fails loudly rather than at the callback.
 *
 * The redirect URI's exact string must byte-match an entry in the IdP's
 * `OIDC_APP_REDIRECT_URIS`; that pairing is documented in the README and
 * enforced by the IdP rejecting a non-matching `redirect_uri` at authorize time.
 * A production redirect over plain http is warned about (real deploys sit behind
 * Tailscale Serve TLS); it is not fatal so the http-on-loopback test harness can
 * still run the production build.
 */
export function validateAuthEnv(auth: AuthEnv, env: AuthEnvSource = process.env): AuthEnv {
  const isProduction = env.NODE_ENV === 'production';

  requireAbsoluteUrl('IDP_ISSUER', auth.issuer);
  const redirect = requireAbsoluteUrl('OIDC_APP_REDIRECT_URI', auth.redirectUri);

  if (!redirect.pathname.endsWith(CALLBACK_PATH)) {
    throw new Error(
      `OIDC_APP_REDIRECT_URI must end with ${CALLBACK_PATH} (the callback route), got "${auth.redirectUri}"`,
    );
  }

  const isLoopback = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1';
  if (isProduction && redirect.protocol !== 'https:' && !isLoopback) {
    console.warn(
      `[auth] OIDC_APP_REDIRECT_URI is not https in production: "${auth.redirectUri}". ` +
        'Tailscale Serve terminates TLS; register the https URL instead.',
    );
  }

  return auth;
}

export function getAuthEnv(env: AuthEnvSource = process.env): AuthEnv {
  const clientSecret = env.OIDC_APP_CLIENT_SECRET?.trim();
  if (!clientSecret && env.NODE_ENV === 'production') {
    throw new Error('OIDC_APP_CLIENT_SECRET must be set in production (no placeholder fallback)');
  }

  const auth: AuthEnv = {
    issuer: getIdpIssuer(env),
    clientId: env.OIDC_APP_CLIENT_ID ?? 'app',
    clientSecret: clientSecret || DEV_APP_CLIENT_SECRET,
    redirectUri: canonicalizeRedirect(
      env.OIDC_APP_REDIRECT_URI ?? 'http://127.0.0.1:3002/auth/callback',
    ),
    resource: env.OIDC_APP_RESOURCE ?? 'https://note-service',
  };
  return validateAuthEnv(auth, env);
}

/**
 * A loopback redirect URI is canonicalized to `localhost`, because that is the
 * host the browser actually ends up on: Next's middleware normalizes any
 * loopback spelling (`127.0.0.1`/`[::1]`/`localhost`) to `localhost` in its
 * redirects. Keeping the configured value as `127.0.0.1` would send the IdP's
 * callback to a different host than the one holding the attempt cookie, which
 * fails closed. Non-loopback (production/Tailscale) redirects are untouched.
 * A malformed value is returned as-is so `validateAuthEnv` can report it.
 */
function canonicalizeRedirect(redirectUri: string): string {
  try {
    return canonicalizeLoopbackUrl(redirectUri);
  } catch {
    return redirectUri;
  }
}

/** True when the issuer is plain http (local dev); `openid-client` needs an opt-in then. */
export function issuerAllowsInsecure(issuer: string): boolean {
  try {
    return new URL(issuer).protocol === 'http:';
  } catch {
    return false;
  }
}
