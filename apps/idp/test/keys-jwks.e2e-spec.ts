import { INestApplication } from '@nestjs/common';

import { execFile } from 'child_process';
import { rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { promisify } from 'util';
import { loadOrCreateKeySet, rotateKeySet, signJwt } from '../src/crypto/signing-keys.js';
import {
  ACCESS_TOKEN_TTL_S,
  accessTokenClaims,
  audienceFor,
} from '../src/oidc/access-token.policy.js';
import { OidcService, isProviderPath } from '../src/oidc/oidc.service.js';

/** ts-node 10 predates Node's ESM detection, so the CJS bin cannot load these
 * ESM scripts; the ESM loader plus a cwd of apps/idp (which selects its
 * NodeNext tsconfig) is what runs them. */
const TS_NODE_ESM_LOADER_ARGS = ['--loader', 'ts-node/esm'];
const execFileAsync = promisify(execFile);
const VERIFY_SCRIPT = join(__dirname, '..', 'scripts', 'verify-jwks.ts');

const TEST_DB = join(__dirname, 'test-idp-keys.db');
const TEST_KEYS = join(__dirname, 'test-idp-keys.json');
const ISSUER = 'http://127.0.0.1:3003';
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

describe('Signing keys and JWKS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('serves the persisted kid and public material only', async () => {
    const set = loadOrCreateKeySet(TEST_KEYS);
    const res = await request(app.getHttpServer()).get('/jwks').expect(200);

    expect(res.body.keys).toHaveLength(set.keys.length);
    const key = res.body.keys[0];
    expect(key.kid).toBe(set.keys[0].kid);
    expect(key.kty).toBe('OKP');
    expect(key.crv).toBe('Ed25519');
    expect(typeof key.x).toBe('string');
    // No private material in any served key.
    for (const k of res.body.keys) {
      expect(k.d).toBeUndefined();
      expect(k.p).toBeUndefined();
      expect(k.q).toBeUndefined();
    }
  });

  it('keeps the same kid after an app restart', async () => {
    const before = loadOrCreateKeySet(TEST_KEYS).keys[0].kid;

    const first = await startApp();
    const firstKid = (await request(first.getHttpServer()).get('/jwks').expect(200)).body.keys[0]
      .kid;
    await first.close();

    const second = await startApp();
    const secondKid = (await request(second.getHttpServer()).get('/jwks').expect(200)).body.keys[0]
      .kid;
    await second.close();

    expect(firstKid).toBe(before);
    expect(secondKid).toBe(before);
  });

  it('writes the key file with mode 0600', () => {
    const mode = statSync(TEST_KEYS).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rotates by prepending a new signing key while keeping old public keys', () => {
    const before = loadOrCreateKeySet(TEST_KEYS);
    const rotated = rotateKeySet(before);
    expect(rotated.keys).toHaveLength(before.keys.length + 1);
    expect(rotated.keys[0].kid).not.toBe(before.keys[0].kid);
    // The previous key is retained for verification.
    expect(rotated.keys.slice(1).map((k) => k.kid)).toEqual(before.keys.map((k) => k.kid));
  });

  it('routes exactly the provider-owned path set', () => {
    // The static gate must cover every endpoint the provider actually serves,
    // and must not swallow our own routes.
    const providerPaths = app.get(OidcService).handledPaths();
    expect(providerPaths.length).toBeGreaterThan(0);
    for (const p of providerPaths) {
      expect(isProviderPath(p)).toBe(true);
    }
    // Paths the enabled features definitely expose: discovery (implicit), auth,
    // token, jwks.
    for (const p of ['/auth', '/token', '/jwks']) {
      expect(providerPaths).toContain(p);
    }
    // Endpoints outside the enable-only surface must NOT be handled (see
    // oidc-config.e2e-spec.ts for the discovery/route absence assertions).
    for (const p of [
      '/me',
      '/session/end',
      '/token/introspection',
      '/token/revocation',
      '/request',
      '/reg',
      '/device/auth',
      '/challenge',
      '/backchannel',
    ]) {
      expect(providerPaths).not.toContain(p);
    }
    expect(isProviderPath('/health')).toBe(false);
    expect(isProviderPath('/login')).toBe(false);
    expect(isProviderPath('/')).toBe(false);
  });
});

describe('Offline verification against fetched JWKS (e2e)', () => {
  const OFFLINE_KEYS = join(__dirname, 'test-idp-offline-keys.json');

  beforeAll(() => {
    process.env.KEYS_PATH = OFFLINE_KEYS;
    rmSync(OFFLINE_KEYS, { force: true });
    loadOrCreateKeySet(OFFLINE_KEYS); // deterministic fixture
  });

  afterAll(() => {
    rmSync(OFFLINE_KEYS, { force: true });
    rmSync(TEST_DB, { force: true });
    process.env.KEYS_PATH = TEST_KEYS;
  });

  it('verifies a signed token in a separate process against the JWKS document alone', async () => {
    const set = loadOrCreateKeySet(OFFLINE_KEYS);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { iss: ISSUER, sub: 'me', aud: 'note-service', iat: now, exp: now + ACCESS_TOKEN_TTL_S },
      set,
    );

    // Fetch the public JWKS from a running app, using the same key file.
    const keysFile = join(__dirname, 'test-idp-offline-public.json');
    rmSync(keysFile, { force: true });
    const app = await startApp();
    const res = await request(app.getHttpServer()).get('/jwks').expect(200);
    await app.close();
    writeFileSync(keysFile, JSON.stringify(res.body));
    rmSync(TEST_DB, { force: true });

    const ok = await runVerifier([
      '--token',
      token,
      '--jwks-file',
      keysFile,
      '--iss',
      ISSUER,
      '--aud',
      'note-service',
    ]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('verified:');
    rmSync(keysFile, { force: true });
  });

  it('rejects a tampered signature', async () => {
    const set = loadOrCreateKeySet(OFFLINE_KEYS);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { iss: ISSUER, sub: 'me', aud: 'note-service', iat: now, exp: now + ACCESS_TOKEN_TTL_S },
      set,
    );
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.AAAA${token.split('.')[2]?.slice(4) ?? ''}`;

    const res = await runVerifier([
      '--token',
      tampered,
      '--jwks-file',
      OFFLINE_KEYS,
      '--iss',
      ISSUER,
    ]);
    expect(res.code).not.toBe(0);
  });

  it('rejects an expired token', async () => {
    const set = loadOrCreateKeySet(OFFLINE_KEYS);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { iss: ISSUER, sub: 'me', aud: 'note-service', iat: now - 1000, exp: now - 400 },
      set,
    );

    const res = await runVerifier(['--token', token, '--jwks-file', OFFLINE_KEYS, '--iss', ISSUER]);
    expect(res.code).not.toBe(0);
  });
});

describe('Access-token policy', () => {
  const POLICY_KEYS = join(__dirname, 'test-idp-policy-keys.json');

  afterAll(() => rmSync(POLICY_KEYS, { force: true }));

  it('produces aud-scoped claims with a 10-minute exp', () => {
    const claims = accessTokenClaims('me', 'note-service', 1_000_000);
    expect(claims).toEqual({
      sub: 'me',
      aud: 'note-service',
      iat: 1_000_000,
      exp: 1_000_000 + 600,
    });
    expect(ACCESS_TOKEN_TTL_S).toBe(600);
  });

  it('scopes the audience to the target service host', () => {
    expect(audienceFor('note-service')).toBe('note-service');
    expect(audienceFor('https://note-service.example/api')).toBe('note-service.example');
  });

  it('signs a JWT that decodes to the expected claims and kid', async () => {
    rmSync(POLICY_KEYS, { force: true });
    const set = loadOrCreateKeySet(POLICY_KEYS);
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({ ...accessTokenClaims('me', 'note-service', now) }, set);

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(set.keys[0].kid);
    expect(header.typ).toBe('at+jwt');

    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet({ keys: [{ ...set.keys[0], d: undefined }] }),
    );
    expect(payload.sub).toBe('me');
    expect(payload.aud).toBe('note-service');
    expect(payload.exp! - payload.iat!).toBe(600);
  });
});
