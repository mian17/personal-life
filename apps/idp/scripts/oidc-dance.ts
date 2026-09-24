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

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) {
    throw new Error('provide --username/--password (or SEED_USERNAME/SEED_PASSWORD)');
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  const nonce = randomBytes(8).toString('hex');

  const authUrl = new URL(`${ISSUER}/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (RESOURCE) authUrl.searchParams.set('resource', RESOURCE);

  const authorize = await get(authUrl.toString());
  const interaction = authorize.headers.get('location');
  console.log(`1. authorize -> ${authorize.status} ${interaction ?? authorize.statusText}`);
  if (!interaction) throw new Error('expected an interaction redirect');

  const interactionUrl = new URL(interaction, ISSUER).toString();
  const form = await get(interactionUrl);
  console.log(`2. interaction -> ${form.status} (login form)`);

  const login = await postForm(interactionUrl, { username: USERNAME, password: PASSWORD });
  console.log(`3. login -> ${login.status} ${login.headers.get('location') ?? ''}`);

  let next = login.headers.get('location');
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
  console.log(`4. code -> ${code ? 'received' : 'MISSING'} (state ${returnedState === state ? 'matches' : 'MISMATCH'})`);
  if (!code) throw new Error('no authorization code returned');

  const tokenRes = await postForm(`${ISSUER}/token`, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
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

  const atClaims = JSON.parse(
    Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString(),
  ) as { aud?: string; exp?: number; iat?: number };
  const idClaims = tokens.id_token
    ? (JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()) as {
        nonce?: string;
      })
    : undefined;
  console.log(`6. access token -> aud=${JSON.stringify(atClaims.aud)} ttl=${(atClaims.exp ?? 0) - (atClaims.iat ?? 0)}s`);
  console.log(`   id_token nonce ${idClaims?.nonce === nonce ? 'matches' : 'MISSING/MISMATCH'}; refresh_token ${tokens.refresh_token ? 'present' : 'absent (expected)'}`);
  console.log(`7. offline verify: node scripts/verify-jwks.ts --token <access_token> --jwks-url ${ISSUER}/jwks --aud ${atClaims.aud}`);
}

main().catch((err: unknown) => {
  console.error('dance failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
