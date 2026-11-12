import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MEAL_TODO_DISCLOSURE, OriginGrant, disclosureHash } from '@life/service-kit';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `POST /api/todos/origin-grant` — the self-service grant (`SPEC-todo-origin`
 * assumption 12).
 *
 * Boots the real Nest app (global `AuthGuard`, real JWKS verification, real sqlite)
 * so both halves of the grant key come from the verified token exactly as they do
 * in production. That is the whole point of this route: the CLI it replaces took an
 * operator's word for the owner and the client, and this one takes neither.
 *
 * The whitelist test is the load-bearing one. `ownerSub` and `clientId` have no
 * field on the DTO, so the only thing standing between a body and a grant it chose
 * for itself is the global pipe's `forbidNonWhitelisted` — with that off, a body
 * naming `ownerSub` is silently stripped instead of refused, and the assertion
 * below changes from a 400 to a 201.
 */

const TEST_DB = join(import.meta.dirname, 'test-origin-grant.db');

const BASE_NODE_ENV = 'test';
const APP_USER = 'user-a';
const OTHER_USER = 'user-b';
/** The client the BFF's own access token names (`apps/idp/src/oidc/clients.ts`). */
const APP_CLIENT = 'app';
const MEAL = 'meal-service';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Self-service origin grant (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let appToken = '';
  let otherToken = '';
  let clientlessToken = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    appToken = await harness.sign({ subject: APP_USER, clientId: APP_CLIENT });
    otherToken = await harness.sign({ subject: OTHER_USER, clientId: APP_CLIENT });
    // A token whose `client_id` claim is absent: there is no grantee to name.
    clientlessToken = await harness.sign({ subject: APP_USER });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  afterEach(() => dataSource.getRepository(OriginGrant).clear());

  const server = () => app.getHttpServer();
  const grant = (body: Record<string, unknown>, token = appToken) =>
    auth(request(server()).post('/api/todos/origin-grant'), token).send(body);
  const rows = () => dataSource.getRepository(OriginGrant).find();

  it("stores the caller's own grant with the disclosure verbatim and its sha256", async () => {
    const response = await grant({ originService: MEAL });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ownerSub: APP_USER,
      clientId: APP_CLIENT,
      originService: MEAL,
    });
    // The consent columns are evidence, not a read model: they are stored but never
    // echoed to the caller who just agreed to them.
    expect(response.body).not.toHaveProperty('disclosure');
    expect(response.body).not.toHaveProperty('disclosureHash');

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      ownerSub: APP_USER,
      clientId: APP_CLIENT,
      originService: MEAL,
      disclosure: MEAL_TODO_DISCLOSURE,
      disclosureHash: disclosureHash(MEAL_TODO_DISCLOSURE),
    });
  });

  it('updates the one row on a repeat grant instead of adding a second', async () => {
    await grant({ originService: MEAL });
    const again = await grant({ originService: MEAL });

    expect(again.status).toBe(201);
    expect(await rows()).toHaveLength(1);
  });

  // The proof: without `forbidNonWhitelisted`, this body is stripped and answered
  // 201 with the caller's own sub, so the assertion below fails.
  it('refuses a body that names its own owner', async () => {
    const response = await grant({ originService: MEAL, ownerSub: OTHER_USER });

    expect(response.status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('refuses a body that names its own client', async () => {
    // `clientId` is the grantee. Accepting it would let any signed-in user hand a
    // producer they do not use write access to their account.
    const response = await grant({ originService: MEAL, clientId: 'producer-a' });

    expect(response.status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('rejects an origin outside the allowlist, naming the allowed set', async () => {
    const response = await grant({ originService: 'calendar-service' });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(MEAL);
    expect(await rows()).toEqual([]);
  });

  it('answers 401 to an unauthenticated call', async () => {
    const response = await request(server())
      .post('/api/todos/origin-grant')
      .send({ originService: MEAL });

    expect(response.status).toBe(401);
    expect(await rows()).toEqual([]);
  });

  it('answers 403 to a token that names no client', async () => {
    // A grant with no grantee authorizes nothing: the row would be unreachable by
    // any producer, so it is refused rather than written.
    const response = await grant({ originService: MEAL }, clientlessToken);

    expect(response.status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it("keeps each owner's grant its own for the same client", async () => {
    await grant({ originService: MEAL });
    await grant({ originService: MEAL }, otherToken);

    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.ownerSub).sort()).toEqual([APP_USER, OTHER_USER]);
    // Both rows name the one client the two tokens were issued to: a grant is per
    // owner *pair*, never a client-global permission.
    expect(new Set(stored.map((row) => row.clientId))).toEqual(new Set([APP_CLIENT]));
  });
});
