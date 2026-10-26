import 'server-only';
import * as client from 'openid-client';
import { getAuthEnv, issuerAllowsInsecure, type AuthEnv } from './env';

/**
 * The single OIDC-client seam. Everything that talks to the IdP goes through
 * this module so route logic can be tested by mocking this boundary rather than
 * reaching into protocol internals.
 *
 * Holds the client secret, so `server-only`.
 */

export interface AuthorizationRequest {
  url: string;
  /** Values the callback must validate; carried through the app session/cookie. */
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  /** Access-token lifetime in seconds, if the IdP reported one. */
  expiresIn?: number;
  subject: string | null;
}

let cached: { config: client.Configuration; env: AuthEnv } | undefined;
let cachedIssuer: string | undefined;

/** Discovers the IdP and builds the client configuration (cached per issuer). */
export async function getConfiguration(env: AuthEnv = getAuthEnv()): Promise<client.Configuration> {
  if (cached && cachedIssuer === env.issuer) return cached.config;

  const options: client.DiscoveryRequestOptions = {};
  if (issuerAllowsInsecure(env.issuer)) {
    // Local dev IdP is plain http; the library is HTTPS-only by default. The
    // escape hatch is deprecated to discourage production use only — every
    // other way to reach a plain-http issuer (`oauth4webapi`'s protocol check,
    // `Configuration.tlsOnly`) is internal, so this is the sole supported path.
    options.execute = [client.allowInsecureRequests]; // NOSONAR: typescript:S1874, documented dev-only escape hatch
  }

  const config = await client.discovery(
    new URL(env.issuer),
    env.clientId,
    { client_secret: env.clientSecret },
    client.ClientSecretBasic(env.clientSecret),
    options,
  );

  cached = { config, env };
  cachedIssuer = env.issuer;
  return config;
}

/** Clears the discovery cache (tests). */
export function resetConfigurationCache(): void {
  cached = undefined;
  cachedIssuer = undefined;
}

/** Builds the authorization URL with PKCE S256 plus `state`, `nonce`, and `resource`. */
export async function buildAuthorizationRequest(
  env: AuthEnv = getAuthEnv(),
): Promise<AuthorizationRequest> {
  const config = await getConfiguration(env);
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: env.redirectUri,
    scope: 'openid',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    // Phase-2 handoff: send the resource indicator explicitly rather than
    // relying on the IdP's DEFAULT_RESOURCE.
    resource: env.resource,
  });

  return { url: url.href, state, nonce, codeVerifier };
}

/** Reads the subject from an id_token without verifying it (the grant already did). */
function subjectFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function toTokens(response: client.TokenEndpointResponse): Tokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? '',
    idToken: response.id_token ?? null,
    expiresIn: response.expires_in,
    subject: subjectFromIdToken(response.id_token),
  };
}

/**
 * Completes the authorization code grant, validating `state`, `nonce`, the PKCE
 * verifier, and the `code`/`iss` in the callback URL. Throws on any failure
 * (fail closed). Sends `resource` again on the token request.
 */
export async function completeAuthorization(
  currentUrl: URL,
  checks: { state: string; nonce: string; codeVerifier: string },
  env: AuthEnv = getAuthEnv(),
): Promise<Tokens> {
  const config = await getConfiguration(env);
  const tokens = await client.authorizationCodeGrant(
    config,
    currentUrl,
    {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    },
    { resource: env.resource },
  );
  return toTokens(tokens);
}

/**
 * Redeems a refresh token (rotation-aware: the response carries a new refresh
 * token). `resource` is repeated per the docs. Throws on failure so callers can
 * treat any error as "re-login".
 */
export async function refreshTokens(
  refreshToken: string,
  env: AuthEnv = getAuthEnv(),
): Promise<Tokens> {
  const config = await getConfiguration(env);
  const tokens = await client.refreshTokenGrant(config, refreshToken, {
    resource: env.resource,
  });
  return toTokens(tokens);
}

export { getIdpIssuer } from './env';
