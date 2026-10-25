import { createHash, randomBytes } from 'crypto';

/**
 * Throwaway OIDC client: runs the full authorization code + PKCE dance against a
 * running idp instance and prints each step. The user's browser would normally
 * follow the redirects; here we drive it over HTTP and read the code from the
 * redirect Location. Used for the Task 5 manual check.
 *
 *   node scripts/oidc-dance.ts --issuer http://127.0.0.1:3090 --username me --password <pw>
 *
 * Secrets/passwords are read from args/env and never logged. Tokens/codes are
 * printed only because this is an interactive verification helper.
 */
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** This script prints values the server chose. One carrying a newline or a
 * control byte would forge extra log lines, so server text is folded onto a
 * single printable line before it is interpolated. */
function oneLine(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ');
}

const ISSUER = (arg('--issuer') ?? process.env.IDP_ISSUER ?? 'http://127.0.0.1:3003').replace(/\/$/, '');
const CLIENT_ID = arg('--client-id') ?? 'dev';
const REDIRECT_URI = arg('--redirect-uri') ?? 'http://127.0.0.1:8080/cb';
const USERNAME = arg('--username') ?? process.env.SEED_USERNAME;
const PASSWORD = arg('--password') ?? process.env.SEED_PASSWORD;
const RESOURCE = arg('--resource');

const jars = new Map<string, string>();

function cookieHeader(url: string): string {
  const origin = new URL(url).origin;
  return [...jars.entries()]
    .filter(([k]) => k.startsWith(`${origin}|`))
    .map(([k, v]) => `${k.split('|')[1]}=${v}`)
    .join('; ');
}

function saveCookies(url: string, res: Response): void {
  const origin = new URL(url).origin;
  const setCookies = res.headers.getSetCookie();
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jars.set(`${origin}|${pair.slice(0, eq)}`, pair.slice(eq + 1));
  }
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader(url) } });
  saveCookies(url, res);
  return res;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(url),
    },
    body,
  });
  saveCookies(url, res);
  return res;
}

interface Pkce {
  verifier: string;
  challenge: string;
}

interface DanceState {
  state: string;
  nonce: string;
}

/** The authorize request with the PKCE challenge and the state/nonce. */
function buildAuthorizeUrl(pkce: Pkce, dance: DanceState): string {
  const authUrl = new URL(`${ISSUER}/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', dance.state);
  authUrl.searchParams.set('nonce', dance.nonce);
  authUrl.searchParams.set('code_challenge', pkce.challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (RESOURCE) authUrl.searchParams.set('resource', RESOURCE);
  return authUrl.toString();
}

/**
 * Follow the post-login redirect chain until it leaves our origin with the code,
 * capturing the returned state. Bounded to five hops.
 */
async function followToCode(next: string | null): Promise<{
  code: string | undefined;
  returnedState: string | undefined;
}> {
  let code: string | undefined;
  let returnedState: string | undefined;
  for (let i = 0; i < 5 && next; i++) {
    const url = new URL(next, ISSUER);
    if (url.origin !== new URL(ISSUER).origin) {
      code = url.searchParams.get('code') ?? undefined;
      returnedState = url.searchParams.get('state') ?? undefined;
      break;
    }
    const res = await get(url.toString());
    console.log(`   resume[${i}] -> ${res.status} ${res.headers.get('location') ?? ''}`);
    next = res.headers.get('location');
  }
  return { code, returnedState };
}

/** Decode a JWT payload (no signature check; `verify-jwks.ts` does that). */
function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

/** Rotate the refresh token, replay the retired one, then prove family revocation. */
async function checkRefreshRotation(
  refreshUse: (rt: string) => Promise<{ status: number; body: RefreshBody }>,
  refreshToken: string,
): Promise<void> {
  const rotated = await refreshUse(refreshToken);
  console.log(
    `7. refresh -> ${oneLine(rotated.status)} newRT=${rotated.body.refresh_token !== refreshToken ? 'yes' : 'no'} at_ttl=${oneLine(rotated.body.expires_in)}s`,
  );
  const newToken = rotated.body.refresh_token;
  if (!newToken) throw new Error('refresh did not return a new refresh token');

  const reuse = await refreshUse(refreshToken);
  console.log(`8. replay retired RT -> ${oneLine(reuse.status)} ${oneLine(reuse.body.error)} (expect 400 invalid_grant)`);

  const afterRevoke = await refreshUse(newToken);
  console.log(`9. newest RT after replay -> ${oneLine(afterRevoke.status)} ${oneLine(afterRevoke.body.error)} (expect 400: family revoked)`);
}

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) {
    throw new Error('provide --username/--password (or SEED_USERNAME/SEED_PASSWORD)');
  }

  const verifier = randomBytes(32).toString('base64url');
  const pkce: Pkce = {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  const dance: DanceState = {
    state: randomBytes(8).toString('hex'),
    nonce: randomBytes(8).toString('hex'),
  };

  const authorize = await get(buildAuthorizeUrl(pkce, dance));
  const interaction = authorize.headers.get('location');
  console.log(`1. authorize -> ${authorize.status} ${interaction ?? authorize.statusText}`);
  if (!interaction) throw new Error('expected an interaction redirect');

  const interactionUrl = new URL(interaction, ISSUER).toString();
  const form = await get(interactionUrl);
  console.log(`2. interaction -> ${form.status} (login form)`);

  const login = await postForm(interactionUrl, { username: USERNAME, password: PASSWORD });
  console.log(`3. login -> ${login.status} ${login.headers.get('location') ?? ''}`);

  const { code, returnedState } = await followToCode(login.headers.get('location'));
  console.log(`4. code -> ${code ? 'received' : 'MISSING'} (state ${returnedState === dance.state ? 'matches' : 'MISMATCH'})`);
  if (!code) throw new Error('no authorization code returned');

  const tokenRes = await postForm(`${ISSUER}/token`, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pkce.verifier,
  });
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  console.log(`5. token -> ${tokenRes.status} ${tokens.error ?? `${tokens.token_type} expires_in=${tokens.expires_in}`}`);
  if (!tokens.access_token) throw new Error(`token exchange failed: ${tokens.error} ${tokens.error_description}`);

  const atClaims = jwtClaims(tokens.access_token) as { aud?: string; exp?: number; iat?: number };
  const idClaims = tokens.id_token ? (jwtClaims(tokens.id_token) as { nonce?: string }) : undefined;
  console.log(`6. access token -> aud=${JSON.stringify(atClaims.aud)} ttl=${(atClaims.exp ?? 0) - (atClaims.iat ?? 0)}s`);
  console.log(`   id_token nonce ${idClaims?.nonce === dance.nonce ? 'matches' : 'MISSING/MISMATCH'}; refresh_token ${tokens.refresh_token ? 'present' : 'absent'}`);

  // 7. Refresh: rotate, then replay the retired token to trigger family revocation.
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) throw new Error('expected a refresh token from the token endpoint');
  const refreshUse = (rt: string) =>
    postJson(`${ISSUER}/token`, {
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: CLIENT_ID,
    });
  await checkRefreshRotation(refreshUse, refreshToken);

  console.log(`10. offline verify: node scripts/verify-jwks.ts --token <access_token> --jwks-url ${ISSUER}/jwks --aud ${atClaims.aud}`);
}

interface RefreshBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postJson(
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: RefreshBody }> {
  const res = await postForm(url, fields);
  const body = (await res.json().catch(() => ({}))) as RefreshBody;
  return { status: res.status, body };
}

main().catch((err: unknown) => {
  console.error('dance failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
