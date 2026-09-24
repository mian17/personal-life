import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { join } from 'path';
import { decodeJwt } from 'jose';
import { Client } from './oidc-harness';
import { SessionsService } from '../src/sessions/sessions.service';
import { UsersService } from '../src/users/users.service';

const TEST_DB = join(__dirname, 'test-idp-logout.db');
const TEST_KEYS = join(__dirname, 'test-idp-logout-keys.json');
const ISSUER = 'http://127.0.0.1:3003';
const REDIRECT_URI = 'http://127.0.0.1:8080/cb';
const PASSWORD = 'fixture-password-not-a-secret';

process.env.DB_PATH = TEST_DB;
process.env.KEYS_PATH = TEST_KEYS;
process.env.IDP_ISSUER = ISSUER;

async function startApp(): Promise<INestApplication> {
  const { createApp } = await import('../src/app.factory');
  const app = await createApp();
  await app.init();
  return app;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/**
 * Full dance for `username`, returning the established cookie-jar client (so the
 * caller can log out) plus the minted tokens.
 */
async function dance(
  app: INestApplication,
  username: string,
): Promise<{ client: Client; tokens: TokenResponse }> {
  const client = new Client(() => app.getHttpServer());
  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({
    client_id: 'dev',
    response_type: 'code',
    scope: 'openid',
    redirect_uri: REDIRECT_URI,
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
        username,
        password: PASSWORD,
      });
      location = submitted.location;
    } else {
      location = form.location;
    }
  }

  let code: string | undefined;
  for (let i = 0; i < 6 && location; i++) {
    if (location.startsWith(REDIRECT_URI)) {
      code = new URL(location).searchParams.get('code') ?? undefined;
      break;
    }
    const url = new URL(location, ISSUER);
    const res = await client.get(url.pathname + url.search);
    location = res.location;
  }
  expect(code).toBeDefined();

  const tokens = await client.postForm('/token', {
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: REDIRECT_URI,
    client_id: 'dev',
    code_verifier: verifier,
  });
  return { client, tokens: (tokens.json as TokenResponse) ?? {} };
}

async function refresh(
  app: INestApplication,
  refreshToken: string,
): Promise<{ status: number; body: TokenResponse }> {
  const client = new Client(() => app.getHttpServer());
  const res = await client.postForm('/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'dev',
  });
  return { status: res.status, body: (res.json as TokenResponse) ?? {} };
}

describe('Logout revokes grants (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    app = await startApp();
    const users = app.get(UsersService);
    await users.createUser('alice', PASSWORD);
    await users.createUser('bob', PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('kills the account refresh token immediately on logout', async () => {
    const { client, tokens } = await dance(app, 'alice');
    expect(tokens.refresh_token).toBeDefined();

    // The refresh token works while logged in.
    const before = await refresh(app, tokens.refresh_token!);
    expect(before.status).toBe(200);
    const rotated = before.body.refresh_token!;

    expect((await client.postForm('/logout', {})).status).toBe(303);

    // Decision B: every refresh token for the account is dead at once — both the
    // one presented before logout and its rotated descendant.
    const afterLogout = await refresh(app, tokens.refresh_token!);
    expect(afterLogout.status).toBe(400);
    expect(afterLogout.body.error).toBe('invalid_grant');

    const descendant = await refresh(app, rotated);
    expect(descendant.status).toBe(400);
    expect(descendant.body.error).toBe('invalid_grant');
  });

  it('does not revoke another account grants', async () => {
    const alice = await dance(app, 'alice');
    const bob = await dance(app, 'bob');
    expect(alice.tokens.refresh_token).toBeDefined();
    expect(bob.tokens.refresh_token).toBeDefined();

    // Alice logs out.
    expect((await alice.client.postForm('/logout', {})).status).toBe(303);

    // Alice is revoked; Bob is untouched.
    const aliceAfter = await refresh(app, alice.tokens.refresh_token!);
    expect(aliceAfter.status).toBe(400);
    expect(aliceAfter.body.error).toBe('invalid_grant');

    const bobAfter = await refresh(app, bob.tokens.refresh_token!);
    expect(bobAfter.status).toBe(200);
    expect(bobAfter.body.refresh_token).toBeDefined();
  });

  it('removes only the logging-out account grant rows from idp.db', async () => {
    const Database = (await import('better-sqlite3')).default;
    const grantIdsFor = (accountId: string): string[] => {
      const db = new Database(TEST_DB, { readonly: true });
      const rows = db
        .prepare("SELECT id, payload FROM oidc_payload WHERE model = 'Grant'")
        .all() as { id: string; payload: string }[];
      db.close();
      return rows
        .filter((r) => (JSON.parse(r.payload) as { accountId?: string }).accountId === accountId)
        .map((r) => r.id);
    };

    const aliceUser = await app.get(UsersService).findByUsername('alice');
    const bobUser = await app.get(UsersService).findByUsername('bob');
    expect(aliceUser).not.toBeNull();
    expect(bobUser).not.toBeNull();

    const alice = await dance(app, 'alice');
    const bob = await dance(app, 'bob');

    const aliceGrantsBefore = grantIdsFor(aliceUser!.id);
    const bobGrantsBefore = grantIdsFor(bobUser!.id);
    expect(aliceGrantsBefore.length).toBeGreaterThan(0);
    expect(bobGrantsBefore.length).toBeGreaterThan(0);

    expect((await alice.client.postForm('/logout', {})).status).toBe(303);

    // Alice's grant rows are gone; Bob's are untouched.
    expect(grantIdsFor(aliceUser!.id)).toHaveLength(0);
    expect(grantIdsFor(bobUser!.id).sort()).toEqual([...bobGrantsBefore].sort());

    // And the behavior follows: Bob can still refresh, Alice cannot.
    expect((await refresh(app, bob.tokens.refresh_token!)).status).toBe(200);
    expect((await refresh(app, alice.tokens.refresh_token!)).status).toBe(400);
  });

  it('leaves the IdP session ended (GET / redirects to login)', async () => {
    const { client } = await dance(app, 'alice');
    expect((await client.postForm('/logout', {})).status).toBe(303);
    const home = await client.get('/');
    expect(home.status).toBe(302);
    expect(home.location).toBe('/login');
    // The Task 3 session row was destroyed too.
    expect(await app.get(SessionsService).findValid(undefined)).toBeNull();
  });

  it('documents the residual: a stateless 10-min access token still verifies after logout', async () => {
    // By design: access tokens are self-contained JWTs verified offline against
    // JWKS, so logout cannot recall them. The short 10-minute TTL is the
    // mitigation. This test pins that behavior so the trade-off is explicit.
    const { client, tokens } = await dance(app, 'alice');
    const accessToken = tokens.access_token!;
    const claims = decodeJwt(accessToken);
    expect(claims.exp! - claims.iat!).toBe(600);

    expect((await client.postForm('/logout', {})).status).toBe(303);

    // The token is still a structurally valid, unexpired JWT after logout.
    const afterLogout = decodeJwt(accessToken);
    expect(afterLogout.exp! - afterLogout.iat!).toBe(600);
    expect(afterLogout.aud).toBe('note-service');
    // But the refresh token that could mint a new one is gone.
    const refreshAfter = await refresh(app, tokens.refresh_token!);
    expect(refreshAfter.status).toBe(400);
  });
});
