import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { join } from 'path';
import { decodeJwt } from 'jose';
import { Client } from './oidc-harness.js';
import { OidcAdapterService } from '../src/oidc/adapter/oidc-adapter.service.js';
import { REFRESH_TOKEN_TTL_S } from '../src/oidc/refresh-token.policy.js';
import { UsersService } from '../src/users/users.service.js';

const TEST_DB = join(__dirname, 'test-idp-refresh.db');
const TEST_KEYS = join(__dirname, 'test-idp-refresh-keys.json');
const ISSUER = 'http://127.0.0.1:3003';
const DEV_REDIRECT = 'http://127.0.0.1:8080/cb';
/** The `app` client's registered redirect in dev (see src/oidc/clients.ts defaults). */
const APP_REDIRECT = 'http://127.0.0.1:3000/auth/callback';
const PASSWORD = 'fixture-password-not-a-secret';
const APP_CLIENT_SECRET = 'app-dev-client-secret-not-a-secret';

process.env.DB_PATH = TEST_DB;
process.env.KEYS_PATH = TEST_KEYS;
process.env.IDP_ISSUER = ISSUER;

async function startApp(): Promise<INestApplication> {
  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();
  await app.init();
  return app;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function authorizeAndExchange(
  app: INestApplication,
  clientId: 'dev' | 'app',
): Promise<TokenResponse> {
  const client = new Client(() => app.getHttpServer());
  const { verifier, challenge } = pkce();
  const redirectUri = clientId === 'app' ? APP_REDIRECT : DEV_REDIRECT;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: redirectUri,
    state: randomBytes(8).toString('hex'),
    nonce: randomBytes(8).toString('hex'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://note-service',
  });

  const auth = await client.get(`/auth?${params.toString()}`);
  let location = auth.location;
  if (location && location.includes('/interaction/')) {
    const interaction = new URL(location, ISSUER);
    const form = await client.get(interaction.pathname);
    if (form.status === 200) {
      const submitted = await client.postForm(interaction.pathname, {
        username: 'alice',
        password: PASSWORD,
      });
      location = submitted.location;
    } else {
      location = form.location;
    }
  }

  // The dance ends when the provider redirects to the RP's redirect_uri; stop
  // there and read the code. Every other redirect is still inside the IdP.
  let code: string | undefined;
  for (let i = 0; i < 6 && location; i++) {
    if (location.startsWith(redirectUri)) {
      code = new URL(location).searchParams.get('code') ?? undefined;
      break;
    }
    const url = new URL(location, ISSUER);
    const res = await client.get(url.pathname + url.search);
    location = res.location;
  }
  expect(code).toBeDefined();

  const fields = {
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };
  const tokens =
    clientId === 'app'
      ? await client.postFormBasic('/token', fields, 'app', APP_CLIENT_SECRET)
      : await client.postForm('/token', { ...fields, client_id: 'dev' });
  return (tokens.json as TokenResponse) ?? {};
}

function refreshWith(
  app: INestApplication,
  clientId: 'dev' | 'app',
  refreshToken: string,
): Promise<{ status: number; body: TokenResponse }> {
  const client = new Client(() => app.getHttpServer());
  if (clientId === 'app') {
    return client
      .postFormBasic(
        '/token',
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        'app',
        APP_CLIENT_SECRET,
      )
      .then((r) => ({ status: r.status, body: (r.json as TokenResponse) ?? {} }));
  }
  return client
    .postForm('/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'dev',
    })
    .then((r) => ({ status: r.status, body: (r.json as TokenResponse) ?? {} }));
}

describe('Refresh tokens: rotation and reuse detection (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    app = await startApp();
    await app.get(UsersService).createUser('alice', PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('rotates on use: new access token + new refresh token, and the old refresh token is dead', async () => {
    const first = await authorizeAndExchange(app, 'dev');
    expect(first.refresh_token).toBeDefined();
    expect(first.expires_in).toBe(600);

    const refreshed = await refreshWith(app, 'dev', first.refresh_token!);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toBeDefined();
    expect(refreshed.body.refresh_token).toBeDefined();
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);

    // The old token was consumed: reusing it fails closed.
    const reuse = await refreshWith(app, 'dev', first.refresh_token!);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  it('reuse of a rotated-out refresh token revokes the whole grant family (newest RT stops working)', async () => {
    const first = await authorizeAndExchange(app, 'dev');

    const rotated = await refreshWith(app, 'dev', first.refresh_token!);
    expect(rotated.status).toBe(200);
    const newest = rotated.body.refresh_token!;

    // Attacker replays the retired token.
    const attack = await refreshWith(app, 'dev', first.refresh_token!);
    expect(attack.status).toBe(400);
    expect(attack.body.error).toBe('invalid_grant');

    // Family revocation: even the legitimate newest descendant is now dead.
    const afterRevoke = await refreshWith(app, 'dev', newest);
    expect(afterRevoke.status).toBe(400);
    expect(afterRevoke.body.error).toBe('invalid_grant');
  });

  it('rejects a refresh token presented by a different client (cross-client binding)', async () => {
    const appTokens = await authorizeAndExchange(app, 'app');
    expect(appTokens.refresh_token).toBeDefined();

    // app's refresh token against the dev client.
    const devUsingAppToken = await refreshWith(app, 'dev', appTokens.refresh_token!);
    expect(devUsingAppToken.status).toBe(400);
    expect(devUsingAppToken.body.error).toBe('invalid_grant');

    const devTokens = await authorizeAndExchange(app, 'dev');
    expect(devTokens.refresh_token).toBeDefined();

    // dev's refresh token against the app client.
    const appUsingDevToken = await refreshWith(app, 'app', devTokens.refresh_token!);
    expect(appUsingDevToken.status).toBe(400);
    expect(appUsingDevToken.body.error).toBe('invalid_grant');

    // The original owners can still use their own tokens.
    const appOwn = await refreshWith(app, 'app', appTokens.refresh_token!);
    expect(appOwn.status).toBe(200);
  });

  it('keeps the access-token lifetime independent of the refresh lifetime', async () => {
    const first = await authorizeAndExchange(app, 'dev');
    const refreshed = await refreshWith(app, 'dev', first.refresh_token!);
    expect(refreshed.status).toBe(200);

    // Independent lifetimes: access 10 min, refresh 30 days.
    expect(refreshed.body.expires_in).toBe(600);
    const at = decodeJwt(refreshed.body.access_token!);
    expect(at.exp! - at.iat!).toBe(600);
    expect(REFRESH_TOKEN_TTL_S).toBe(30 * 24 * 60 * 60);
  });

  it('persists refresh tokens in idp.db and marks rotated-out tokens consumed', async () => {
    const adapter = app.get(OidcAdapterService);
    const first = await authorizeAndExchange(app, 'dev');
    const refreshAdapter = adapter.factory()('RefreshToken');

    const stored = await refreshAdapter.find(first.refresh_token!);
    expect(stored).toBeDefined();
    expect(stored!.consumed).toBeUndefined();
    expect(await adapter.count('RefreshToken')).toBeGreaterThan(0);

    const rotated = await refreshWith(app, 'dev', first.refresh_token!);
    expect(rotated.status).toBe(200);

    const afterUse = await refreshAdapter.find(first.refresh_token!);
    expect(afterUse?.consumed).toBeDefined();
  });
});
