import { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'http';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

/**
 * JWT verification e2e (Task 9, dual-accept).
 *
 * A tiny local HTTP server serves a JWKS built from ephemeral Ed25519 keys
 * generated in beforeAll and discarded after — no key material is ever
 * committed. The IdP is never called: verification is offline against this JWKS.
 */

const TEST_DB = join(__dirname, 'test-auth.db');
process.env.DB_PATH = TEST_DB;
process.env.API_TOKEN = 'static-token-not-a-secret';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'note-service';

interface TestKey {
  privateKey: CryptoKey;
  jwk: Record<string, unknown>;
  kid: string;
}

async function newKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return {
    privateKey,
    kid,
    jwk: { ...publicJwk, kid, alg: 'EdDSA', use: 'sig' },
  };
}

async function sign(
  key: TestKey,
  overrides: {
    issuer?: string;
    audience?: string;
    expiresIn?: number;
    extra?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 'user-1', ...overrides.extra })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (overrides.expiresIn ?? 600))
    .sign(key.privateKey);
}

describe('JWT auth (e2e)', () => {
  let app: INestApplication;
  let jwksServer: Server;
  let jwksUrl: string;
  let currentKeys: TestKey[];
  let originalEnv: NodeJS.ProcessEnv;

  // Serve the *current* key set so tests can rotate keys mid-run.
  const jwksDocument = () => ({ keys: currentKeys.map((k) => k.jwk) });

  beforeAll(async () => {
    originalEnv = { ...process.env };
    const first = await newKey('key-1');
    currentKeys = [first];

    jwksServer = createServer((req, res) => {
      if (req.url === '/jwks') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(jwksDocument()));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
    const port = (jwksServer.address() as { port: number }).port;
    jwksUrl = `http://127.0.0.1:${port}/jwks`;

    process.env.IDP_ISSUER = ISSUER;
    process.env.IDP_JWKS_URL = jwksUrl;
    process.env.NOTE_SERVICE_AUDIENCE = AUDIENCE;
    // Make rotation deterministic: an unknown kid may refetch immediately rather
    // than waiting out jose's default 30s cooldown.
    process.env.IDP_JWKS_COOLDOWN_MS = '0';

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await new Promise<void>((r) => jwksServer.close(() => r()));
    process.env = originalEnv;
  });

  const get = (token?: string) => {
    const r = request(app.getHttpServer()).get('/api/notes');
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('accepts a valid JWT', async () => {
    const token = await sign(currentKeys[0]);
    const res = await get(token).expect(200);
    expect(res.body).toHaveProperty('notes');
  });

  it('rejects a wrong-audience JWT', async () => {
    const token = await sign(currentKeys[0], { audience: 'todo-service' });
    await get(token).expect(401);
  });

  it('rejects an issuer mismatch', async () => {
    const token = await sign(currentKeys[0], { issuer: 'https://evil.test' });
    await get(token).expect(401);
  });

  it('rejects an expired JWT', async () => {
    const token = await sign(currentKeys[0], { expiresIn: -60 });
    await get(token).expect(401);
  });

  it('rejects a tampered signature', async () => {
    const token = await sign(currentKeys[0]);
    const [h, p, s] = token.split('.');
    const tampered = `${h}.${p}.AAAA${s.slice(4)}`;
    await get(tampered).expect(401);
  });

  it('rejects a garbage or missing header', async () => {
    await get().expect(401);
    await get('not-a-jwt').expect(401);
    // JWT-shaped but unparseable.
    await get('aaa.bbb.ccc').expect(401);
  });

  it('verifies a JWT signed by a rotated kid (rotation tolerance)', async () => {
    // Add a new key to the served JWKS and sign with it; the previously cached
    // set lacks this kid, so the resolver refetches.
    const rotated = await newKey(`key-${Date.now()}`);
    currentKeys = [currentKeys[0], rotated];

    const token = await sign(rotated);
    await get(token).expect(200);
  });

  it('still accepts the static API_TOKEN (dual-accept)', async () => {
    await get('static-token-not-a-secret').expect(200);
  });
});
