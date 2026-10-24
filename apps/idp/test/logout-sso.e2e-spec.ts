import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { join } from 'path';
import { Client } from './oidc-harness';
import { UsersService } from '../src/users/users.service';

const TEST_DB = join(__dirname, 'test-idp-logout-sso.db');
const TEST_KEYS = join(__dirname, 'test-idp-logout-sso-keys.json');
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

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizePath(): string {
  const params = new URLSearchParams({
    client_id: 'dev',
    response_type: 'code',
    scope: 'openid',
    redirect_uri: REDIRECT_URI,
    state: randomBytes(8).toString('hex'),
    nonce: randomBytes(8).toString('hex'),
    code_challenge: pkce().challenge,
    code_challenge_method: 'S256',
    resource: 'https://note-service',
  });
  return `/auth?${params.toString()}`;
}

/** True when an authorize response asks for the login form (interaction). */
function needsLogin(location: string | undefined): boolean {
  return (location ?? '').includes('/interaction/');
}

/**
 * Completes a dance for `username`, driving the login form if the authorize
 * step asks for it. Returns the same cookie-jar client for later requests.
 */
async function dance(app: INestApplication, username: string): Promise<Client> {
  const client = new Client(() => app.getHttpServer());
  const { challenge } = pkce();
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

  let location = (await client.get(`/auth?${params.toString()}`)).location;
  if (needsLogin(location)) {
    const interaction = new URL(location!, ISSUER);
    const form = await client.get(interaction.pathname);
    if (form.status === 200) {
      location = (
        await client.postForm(interaction.pathname, { username, password: PASSWORD })
      ).location;
    } else {
      location = form.location;
    }
  }
  for (let i = 0; i < 6 && location; i++) {
    if (location.startsWith(REDIRECT_URI)) break;
    const url = new URL(location, ISSUER);
    const res = await client.get(url.pathname + url.search);
    location = res.location;
  }
  return client;
}

describe('Logout ends the SSO session (e2e)', () => {
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

  it('contrast: a live provider session skips login, but not after logout', async () => {
    const client = await dance(app, 'alice');

    // Before logout: the provider SSO session is live, so a fresh authorize
    // resolves straight to a code — no interaction/login form.
    const before = await client.get(authorizePath());
    expect(before.status).toBe(303);
    expect(needsLogin(before.location)).toBe(false);
    expect(before.location ?? '').toContain('code=');

    const logout = await client.postForm('/logout', {});
    expect(logout.status).toBe(303);

    // After logout: the SSO session is gone, so a fresh authorize must prompt.
    const after = await client.get(authorizePath());
    expect(after.status).toBe(303);
    expect(needsLogin(after.location)).toBe(true);
  });

  it('clears both the provider _session cookie and our session cookie', async () => {
    const client = await dance(app, 'alice');
    const logout = await client.postForm('/logout', {});
    expect(logout.status).toBe(303);

    const cleared = logout.setCookie ?? [];
    // The provider's own session cookie is cleared (name from the provider API, `_session`).
    expect(cleared.some((c) => c.startsWith('_session='))).toBe(true);
    // Our login session cookie is cleared too.
    expect(cleared.some((c) => c.startsWith('idp_session='))).toBe(true);

    // Re-entering shows the login page (no session of either kind remains).
    const home = await client.get('/');
    expect(home.status).toBe(302);
    expect(home.location).toBe('/login');
  });

  it('removes the account Session rows from idp.db, leaving other accounts intact', async () => {
    const Database = (await import('better-sqlite3')).default;
    const sessionIdsFor = (accountId: string): string[] => {
      const db = new Database(TEST_DB, { readonly: true });
      const rows = db
        .prepare("SELECT id, payload FROM oidc_payload WHERE model = 'Session'")
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

    expect(sessionIdsFor(aliceUser!.id).length).toBeGreaterThan(0);
    const bobSessionsBefore = sessionIdsFor(bobUser!.id);
    expect(bobSessionsBefore.length).toBeGreaterThan(0);

    expect((await alice.postForm('/logout', {})).status).toBe(303);

    // Alice's Session rows are gone; Bob's are untouched.
    expect(sessionIdsFor(aliceUser!.id)).toHaveLength(0);
    expect(sessionIdsFor(bobUser!.id).sort((a: string, b: string) => a.localeCompare(b))).toEqual([...bobSessionsBefore].sort((a: string, b: string) => a.localeCompare(b)));

    // And Bob's provider session still skips login.
    const bobAuthorize = await bob.get(authorizePath());
    expect(needsLogin(bobAuthorize.location)).toBe(false);
  });
});
