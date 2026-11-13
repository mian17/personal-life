import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AuthGuard, Principal } from '@life/service-kit';
import { VERIFIER_ENV } from '../src/service-config.js';
import { configureVerifierEnv, JwtTestHarness, TEST_AUDIENCE, TEST_ISSUER } from './jwt-harness.js';

/**
 * JWT-only auth e2e (Task 10). Every request is verified through the real guard
 * against an ephemeral local JWKS — the IdP is never called. The former static
 * token case was deleted with the path it covered.
 */

const TEST_DB = join(import.meta.dirname, 'test-auth.db');
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
    const { createApp } = await import('../src/app.factory.js');
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
    const res = await get(await harness.sign({ audience: 'todo-service' })).expect(401);
    expect(res.status).toBe(401);
  });

  it('rejects an issuer mismatch', async () => {
    const res = await get(await harness.sign({ issuer: 'https://evil.test' })).expect(401);
    expect(res.status).toBe(401);
  });

  it('rejects an expired JWT', async () => {
    const res = await get(await harness.sign({ expiresIn: -60 })).expect(401);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered signature', async () => {
    const token = await harness.sign();
    const [h, p, s] = token.split('.');
    const res = await get(`${h}.${p}.AAAA${s.slice(4)}`).expect(401);
    expect(res.status).toBe(401);
  });

  it('rejects a garbage or missing header', async () => {
    const missing = await get().expect(401);
    const garbage = await get('not-a-jwt').expect(401);
    const threeParts = await get('aaa.bbb.ccc').expect(401);
    expect(missing.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect(threeParts.status).toBe(401);
  });

  it('verifies a JWT signed by a rotated kid (rotation tolerance)', async () => {
    const rotated = await harness.rotate();
    const res = await get(await harness.sign({ kid: rotated.kid })).expect(200);
    expect(res.body).toHaveProperty('notes');
  });

  it('rejects a non-JWT bearer (the static token is gone)', async () => {
    // A non-JWT bearer is no longer a credential of any kind.
    const res = await get('static-token-not-a-secret').expect(401);
    expect(res.status).toBe(401);
  });

  it('uses the configured issuer constant in tests', () => {
    expect(TEST_ISSUER).toBe('https://idp.test');
    expect(TEST_AUDIENCE).toBe('note-service');
  });
});

/**
 * Principal-seam suite (Task 1). A standalone test module — just the probe
 * controller and the real guard — so a tiny in-test route can observe
 * `@Principal()` without touching production code or a database. `NODE_ENV` is
 * saved/restored around every case because jest workers share `process.env` and
 * the guard's dev bypass reads it at request time.
 */
describe('JWT auth principal seam (e2e)', () => {
  @Controller('api/__principal')
  class PrincipalProbeController {
    @Get()
    probe(@Principal() principal: { sub: string }) {
      return principal;
    }
  }

  let app: INestApplication;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);

    const moduleRef = await Test.createTestingModule({
      controllers: [PrincipalProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
    await app.init();
  });

  afterEach(() => {
    // The dev bypass must never leak into a later spec sharing this worker.
    process.env.NODE_ENV = originalEnv.NODE_ENV;
  });

  afterAll(async () => {
    await app.close();
    await harness.stop();
    process.env = originalEnv;
  });

  const probe = (token?: string) => {
    const r = request(app.getHttpServer()).get('/api/__principal');
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('propagates the verified token sub as the principal', async () => {
    const res = await probe(await harness.sign({ subject: 'alice' })).expect(200);
    expect(res.body).toEqual({ sub: 'alice', clientId: null });
  });

  it('rejects a verified token with no sub claim', async () => {
    const res = await probe(await harness.sign({ omitSubject: true })).expect(401);
    expect(res.status).toBe(401);
  });

  it('rejects a verified token with an empty-string sub', async () => {
    const res = await probe(await harness.sign({ subject: '' })).expect(401);
    expect(res.status).toBe(401);
  });

  it('sets the dev-user principal under NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    const res = await probe().expect(200);
    expect(res.body).toEqual({ sub: 'dev-user', clientId: null });
  });

  it('still rejects a missing or garbage token', async () => {
    const missing = await probe().expect(401);
    const garbage = await probe('not-a-jwt').expect(401);
    const threeParts = await probe('aaa.bbb.ccc').expect(401);
    expect(missing.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect(threeParts.status).toBe(401);
  });
});
