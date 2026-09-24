import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import {
  configureVerifierEnv,
  JwtTestHarness,
  TEST_AUDIENCE,
  TEST_ISSUER,
} from './jwt-harness';

/**
 * JWT-only auth e2e (Task 10). Every request is verified through the real guard
 * against an ephemeral local JWKS — the IdP is never called. The former static
 * token case was deleted with the path it covered.
 */

const TEST_DB = join(__dirname, 'test-auth.db');
process.env.DB_PATH = TEST_DB;

describe('JWT auth (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const get = (token?: string) => {
    const r = request(app.getHttpServer()).get('/api/notes');
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('accepts a valid JWT', async () => {
    const res = await get(await harness.sign()).expect(200);
    expect(res.body).toHaveProperty('notes');
  });

  it('rejects a wrong-audience JWT', async () => {
    await get(await harness.sign({ audience: 'todo-service' })).expect(401);
  });

  it('rejects an issuer mismatch', async () => {
    await get(await harness.sign({ issuer: 'https://evil.test' })).expect(401);
  });

  it('rejects an expired JWT', async () => {
    await get(await harness.sign({ expiresIn: -60 })).expect(401);
  });

  it('rejects a tampered signature', async () => {
    const token = await harness.sign();
    const [h, p, s] = token.split('.');
    await get(`${h}.${p}.AAAA${s.slice(4)}`).expect(401);
  });

  it('rejects a garbage or missing header', async () => {
    await get().expect(401);
    await get('not-a-jwt').expect(401);
    await get('aaa.bbb.ccc').expect(401);
  });

  it('verifies a JWT signed by a rotated kid (rotation tolerance)', async () => {
    const rotated = await harness.rotate();
    await get(await harness.sign({ kid: rotated.kid })).expect(200);
  });

  it('rejects a non-JWT bearer (the static token is gone)', async () => {
    // A non-JWT bearer is no longer a credential of any kind.
    await get('static-token-not-a-secret').expect(401);
  });

  it('uses the configured issuer constant in tests', () => {
    expect(TEST_ISSUER).toBe('https://idp.test');
    expect(TEST_AUDIENCE).toBe('note-service');
  });
});
