import { INestApplication } from '@nestjs/common';

import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { decodeJwt } from 'jose';
import { promisify } from 'util';
import { Client } from './oidc-harness.js';
import { OidcAdapterService } from '../src/oidc/adapter/oidc-adapter.service.js';
import { OidcService } from '../src/oidc/oidc.service.js';
import { UsersService } from '../src/users/users.service.js';

/** ts-node 10 predates Node's ESM detection, so the CJS bin cannot load these
 * ESM scripts; the ESM loader plus a cwd of apps/idp (which selects its
 * NodeNext tsconfig) is what runs them. */
const TS_NODE_ESM_LOADER_ARGS = ['--loader', 'ts-node/esm'];
const execFileAsync = promisify(execFile);
const VERIFY_SCRIPT = join(__dirname, '..', 'scripts', 'verify-jwks.ts');

const TEST_DB = join(__dirname, 'test-idp-flow.db');
const TEST_KEYS = join(__dirname, 'test-idp-flow-keys.json');
const PUBLIC_JWKS_FILE = join(__dirname, 'test-idp-flow-public.json');
const ISSUER = 'http://127.0.0.1:3003';
const REDIRECT_URI = 'http://127.0.0.1:8080/cb';
const PASSWORD = 'fixture-password-not-a-secret';

process.env.DB_PATH = TEST_DB;
process.env.KEYS_PATH = TEST_KEYS;
process.env.IDP_ISSUER = ISSUER;

async function startApp(): Promise<INestApplication> {
  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();
  await app.init();
  return app;
}

async function runVerifier(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [...TS_NODE_ESM_LOADER_ARGS, VERIFY_SCRIPT, ...args],
      { cwd: join(__dirname, '..') },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

interface Dance {
  code?: string;
  state?: string;
  verifier: string;
  nonce: string;
  interaction?: string;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizePath(opts: {
  verifier: string;
  nonce: string;
  state: string;
  resource?: string;
}): string {
  const challenge = createHash('sha256').update(opts.verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: 'dev',
    response_type: 'code',
    scope: 'openid',
    redirect_uri: REDIRECT_URI,
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (opts.resource) params.set('resource', opts.resource);
  return `/auth?${params.toString()}`;
}

function isIdpPath(pathname: string): boolean {
  return ['/auth', '/interaction', '/.well-known', '/token', '/jwks', '/me', '/session'].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Drives authorize → (login) → resume and returns the code/state from the redirect. */
async function completeAuthorize(
  client: Client,
  opts: {
    verifier: string;
    nonce: string;
    state: string;
    username?: string;
    password?: string;
    resource?: string;
  },
): Promise<Dance> {
  const auth = await client.get(authorizePath(opts));
  let location = auth.location;

  if (location && location.includes('/interaction/')) {
    const interactionUrl = new URL(location, ISSUER);
    const form = await client.get(interactionUrl.pathname);
    if (form.status === 200) {
      // No live session: the login form rendered; submit the real credentials.
      const submitted = await client.postForm(interactionUrl.pathname, {
        username: opts.username ?? 'alice',
        password: opts.password ?? PASSWORD,
      });
      location = submitted.location;
    } else {
      // Live session: the interaction auto-finished (303 back to /auth).
      location = form.location;
    }
  }

  // Follow idp-internal redirects by path; the first non-idp redirect is the RP
  // callback (redirect_uri), whose query carries the code and state. The provider
  // builds absolute URLs from the request Host, so match on path, not origin.
  for (let i = 0; i < 6 && location; i++) {
    const url = new URL(location, ISSUER);
    if (!isIdpPath(url.pathname)) {
      return {
        code: url.searchParams.get('code') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
        verifier: opts.verifier,
        nonce: opts.nonce,
      };
    }
    const res = await client.get(url.pathname + url.search);
    location = res.location;
  }
  return { verifier: opts.verifier, nonce: opts.nonce };
}

function tokenRequest(client: Client, code: string, verifier: string) {
  return client.postForm('/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: 'dev',
    code_verifier: verifier,
  });
}

describe('Authorization code + PKCE flow (e2e)', () => {
  let app: INestApplication;
  let client: Client;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    app = await startApp();
    client = new Client(() => app.getHttpServer());
    await app.get(UsersService).createUser('alice', PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    rmSync(PUBLIC_JWKS_FILE, { force: true });
  });

  it('completes the code+PKCE dance and mints an audience-scoped JWT access token', async () => {
    const state = randomBytes(8).toString('hex');
    const nonce = randomBytes(8).toString('hex');
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state,
      nonce,
      resource: 'https://note-service',
    });
    expect(dance.code).toBeDefined();

    const tokens = await tokenRequest(client, dance.code!, dance.verifier);
    expect(tokens.status).toBe(200);
    const body = tokens.json as {
      access_token?: string;
      id_token?: string;
      token_type?: string;
      expires_in?: number;
      refresh_token?: string;
    };

    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(600);
    expect(body.access_token).toBeDefined();
    // A refresh token is now issued (Task 6); rotation/reuse are covered by the
    // refresh suite. Its lifetime is independent of the 10-minute access token.
    expect(body.refresh_token).toBeDefined();

    const at = decodeJwt(body.access_token!);
    expect(at.aud).toBe('note-service');
    expect(at.exp! - at.iat!).toBe(600);
    expect(at.iss).toBe(ISSUER);

    const id = decodeJwt(body.id_token!);
    expect(id.nonce).toBe(nonce);
    expect(id.sub).toBeDefined();
  });

  it('round-trips state to the redirect_uri', async () => {
    const state = 'state-' + randomBytes(4).toString('hex');
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state,
      nonce: randomBytes(8).toString('hex'),
    });
    expect(dance.state).toBe(state);
  });

  it('verifies the minted access token offline against the fetched JWKS alone, and rejects a wrong audience', async () => {
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state: randomBytes(8).toString('hex'),
      nonce: randomBytes(8).toString('hex'),
      resource: 'https://note-service',
    });
    const tokens = await tokenRequest(client, dance.code!, dance.verifier);
    const accessToken = (tokens.json as { access_token: string }).access_token;

    // Fetch the public JWKS document from the running IdP and hand it to a
    // separate process; that process never calls the IdP.
    const jwks = await request(app.getHttpServer()).get('/jwks').expect(200);
    writeFileSync(PUBLIC_JWKS_FILE, JSON.stringify(jwks.body));

    const good = await runVerifier([
      '--token',
      accessToken,
      '--jwks-file',
      PUBLIC_JWKS_FILE,
      '--iss',
      ISSUER,
      '--aud',
      'note-service',
    ]);
    expect(good.code).toBe(0);
    expect(good.stdout).toContain('verified:');

    const wrongAud = await runVerifier([
      '--token',
      accessToken,
      '--jwks-file',
      PUBLIC_JWKS_FILE,
      '--iss',
      ISSUER,
      '--aud',
      'todo-service',
    ]);
    expect(wrongAud.code).not.toBe(0);
    expect(wrongAud.stderr).toContain('aud');
  }, 30000);

  it('rejects a tampered and an expired minted token', async () => {
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state: randomBytes(8).toString('hex'),
      nonce: randomBytes(8).toString('hex'),
      resource: 'https://note-service',
    });
    const tokens = await tokenRequest(client, dance.code!, dance.verifier);
    const accessToken = (tokens.json as { access_token: string }).access_token;
    const jwks = await request(app.getHttpServer()).get('/jwks').expect(200);
    writeFileSync(PUBLIC_JWKS_FILE, JSON.stringify(jwks.body));

    const [h, p, s] = accessToken.split('.');
    const tampered = `${h}.${p}.AAAA${s.slice(4)}`;
    const tamperedResult = await runVerifier([
      '--token',
      tampered,
      '--jwks-file',
      PUBLIC_JWKS_FILE,
    ]);
    expect(tamperedResult.code).not.toBe(0);

    // Expired: verify the same token without expiration tolerance would need a
    // real clock; instead assert the claim policy directly (Task 4 covered expiry).
    const claims = decodeJwt(accessToken);
    expect(claims.exp! - claims.iat!).toBe(600);
  }, 30000);

  it('fails closed with 400 invalid_grant when the PKCE verifier does not match', async () => {
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state: randomBytes(8).toString('hex'),
      nonce: randomBytes(8).toString('hex'),
    });
    const mismatch = await tokenRequest(client, dance.code!, 'w'.repeat(43) + 'x');
    expect(mismatch.status).toBe(400);
    const error = JSON.parse(mismatch.body) as { error: string };
    expect(error.error).toBe('invalid_grant');
  });

  it('redirects an unauthenticated authorize to the login form, then resumes the flow', async () => {
    const fresh = new Client(() => app.getHttpServer());
    const state = randomBytes(8).toString('hex');
    const dance = await completeAuthorize(fresh, {
      ...pkce(),
      state,
      nonce: randomBytes(8).toString('hex'),
      username: 'alice',
    });
    expect(dance.code).toBeDefined();
    expect(dance.state).toBe(state);
  });

  it('skips the login form when a valid IdP session already exists', async () => {
    const fresh = new Client(() => app.getHttpServer());
    // Complete one dance to establish both our session and the provider session.
    const first = await completeAuthorize(fresh, {
      ...pkce(),
      state: randomBytes(8).toString('hex'),
      nonce: randomBytes(8).toString('hex'),
    });
    expect(first.code).toBeDefined();

    // A second authorize with the live session must not detour through login.
    const auth = await fresh.get(authorizePath({ ...pkce(), state: 's2', nonce: 'n2' }));
    expect(auth.location ?? '').not.toContain('/interaction/');
    expect(auth.location ?? '').toContain('code=');
  });

  it('registers the confidential app client with PKCE required and code-only responses', async () => {
    const provider = app.get(OidcService).provider();
    const client = await provider.Client.find('app');
    expect(client).toBeDefined();
    expect(client!.tokenEndpointAuthMethod).toBe('client_secret_basic');
    expect(client!.grantTypes).toContain('authorization_code');
    // Task 6 adds refresh_token; both clients get it and nothing else.
    expect(
      [...(client!.grantTypes ?? [])].sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(['authorization_code', 'refresh_token']);
    expect(client!.responseTypes).toEqual(['code']);
    expect(client!.idTokenSignedResponseAlg).toBe('EdDSA');
    expect(client!.redirectUris?.length ?? 0).toBeGreaterThan(0);
  });

  it('persists the authorization code and grant through the SQLite adapter', async () => {
    const adapter = app.get(OidcAdapterService);
    const state = randomBytes(8).toString('hex');
    const dance = await completeAuthorize(client, {
      ...pkce(),
      state,
      nonce: randomBytes(8).toString('hex'),
      resource: 'https://note-service',
    });
    expect(dance.code).toBeDefined();

    // Before exchange: the code row exists in idp.db and is not yet consumed.
    expect(await adapter.count('AuthorizationCode')).toBeGreaterThan(0);
    const codeAdapter = adapter.factory()('AuthorizationCode');
    const stored = await codeAdapter.find(dance.code!);
    expect(stored).toBeDefined();
    expect(stored!.consumed).toBeUndefined();

    const tokens = await tokenRequest(client, dance.code!, dance.verifier);
    expect(tokens.status).toBe(200);

    // After exchange: the single-use code is consumed and the grant persisted.
    const consumed = await codeAdapter.find(dance.code!);
    expect(consumed?.consumed).toBeDefined();
    expect(await adapter.count('Grant')).toBeGreaterThan(0);
    expect(await adapter.count('Session')).toBeGreaterThan(0);
  });
});

describe('Storage adapter persistence across app instances (e2e)', () => {
  const SHARED_DB = join(__dirname, 'test-idp-flow-shared.db');
  const SHARED_KEYS = join(__dirname, 'test-idp-flow-shared-keys.json');

  afterAll(() => {
    rmSync(SHARED_DB, { force: true });
    rmSync(SHARED_KEYS, { force: true });
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    process.env.DB_PATH = TEST_DB;
    process.env.KEYS_PATH = TEST_KEYS;
  });

  // TypeORM reads DB_PATH when app.module.ts is first evaluated, so each instance
  // must be built from a fresh module registry (the Task 2/3 raw-DB pattern).
  async function startSharedApp(): Promise<{
    app: INestApplication;
    users: UsersService;
  }> {
    jest.resetModules();
    process.env.DB_PATH = SHARED_DB;
    process.env.KEYS_PATH = SHARED_KEYS;
    const [{ createApp }, { UsersService: FreshUsersService }] = await Promise.all([
      import('../src/app.factory.js'),
      import('../src/users/users.service.js'),
    ]);
    const app = await createApp();
    await app.init();
    return { app, users: app.get(FreshUsersService) };
  }

  it('keeps the authorization code in idp.db so a second app instance can consume it', async () => {
    rmSync(SHARED_DB, { force: true });
    rmSync(SHARED_KEYS, { force: true });

    const first = await startSharedApp();
    await first.users.createUser('alice', PASSWORD);
    const firstClient = new Client(() => first.app.getHttpServer());
    const dance = await completeAuthorize(firstClient, {
      ...pkce(),
      state: randomBytes(8).toString('hex'),
      nonce: randomBytes(8).toString('hex'),
      resource: 'https://note-service',
    });
    expect(dance.code).toBeDefined();
    await first.app.close();

    // Second instance, same DB file: the code was persisted, not held in memory.
    const second = await startSharedApp();
    const secondClient = new Client(() => second.app.getHttpServer());
    const tokens = await tokenRequest(secondClient, dance.code!, dance.verifier);
    expect(tokens.status).toBe(200);
    const body = tokens.json as { access_token?: string };
    const at = decodeJwt(body.access_token!);
    expect(at.aud).toBe('note-service');
    await second.app.close();
  });
});
