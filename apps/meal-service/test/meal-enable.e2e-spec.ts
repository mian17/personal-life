import { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'http';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MEAL_TODO_DISCLOSURE, Outbox, disclosureHash } from '@life/service-kit';
import { MealTodoToggle } from '../src/meal-todo/meal-toggle.entity.js';
import { MEAL_ORIGIN_SERVICE, TODOS_CREATE } from '../src/meal-todo/todo-intents.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `POST`/`DELETE`/`GET /api/meal-todo` — the first-use enablement flow
 * (`SPEC-todo-origin` assumption 12).
 *
 * The grant call is the one thing this suite cannot let reach the wire: the route
 * forwards the caller's token to todo-service, and a real call would need a running
 * hub. So a local HTTP server stands in for it and records what arrived — which is
 * also how the assertion knows the bearer token was forwarded rather than a service
 * credential invented.
 *
 * The disclosure assertion is byte-for-byte against the shared constant: it is the
 * only place the canonical sentence is pinned, and the producer suite's own fixture
 * string deliberately differs (it tests the toggle, not the wording).
 */

const TEST_DB = join(import.meta.dirname, 'test-meal-enable.db');

const BASE_NODE_ENV = 'test';
const APP_USER = 'user-a';
const DAY = '2026-09-03';
const CALORIES = 2200;

/** The sentence the prompt fixes, spelled out here so a constant edit fails this test. */
const CANONICAL_DISCLOSURE =
  'Let meals create and tick three daily tasks in your todos — breakfast, lunch and ' +
  'dinner — and tick each one off as soon as you log something in that group.';

interface GrantCall {
  authorization: string | undefined;
  body: unknown;
}

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Meal todo enablement (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let token = '';
  let grantServer: Server;
  let grantCalls: GrantCall[] = [];
  let grantedStatus = 201;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    // Stand-in for todo-service's grant route: records the call, answers with the
    // status the test asked for.
    grantServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        grantCalls.push({
          authorization: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
        });
        res.statusCode = grantedStatus;
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => grantServer.listen(0, '127.0.0.1', resolve));
    process.env.MEAL_TODOS_API_URL = `http://127.0.0.1:${
      (grantServer.address() as { port: number }).port
    }`;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ subject: APP_USER });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);

    // A target is what the three creates are titled from; without one the producer
    // degrades and enqueues nothing, which would make the create assertions vacuous.
    await dataSource.getRepository('Target').insert({
      ownerSub: APP_USER,
      validFrom: '2026-01-01',
      age: 30,
      sex: 'male',
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
      bmr: 1700,
      tdee: 2400,
      calories: CALORIES,
      proteinG: 120,
      fatG: 70,
      carbG: 250,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    await new Promise<void>((resolve) => grantServer.close(() => resolve()));
    process.env = originalEnv;
  });

  beforeEach(async () => {
    grantCalls = [];
    grantedStatus = 201;
    await dataSource.getRepository(MealTodoToggle).clear();
    await dataSource.getRepository(Outbox).clear();
  });

  const server = () => app.getHttpServer();
  const enable = (body: Record<string, unknown>, date = DAY) =>
    auth(request(server()).post('/api/meal-todo'), token).query({ date }).send(body);
  const toggles = () => dataSource.getRepository(MealTodoToggle).find();
  const creates = async () => {
    const rows = await dataSource.getRepository(Outbox).find();
    return rows.filter((row) => row.destination === TODOS_CREATE);
  };

  it('writes one toggle row with the disclosure and its hash, and enqueues three creates', async () => {
    const response = await enable({ enabled: true });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ enabled: true });

    const stored = await toggles();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      ownerSub: APP_USER,
      disclosure: MEAL_TODO_DISCLOSURE,
      disclosureHash: disclosureHash(MEAL_TODO_DISCLOSURE),
    });

    const enqueued = await creates();
    expect(enqueued).toHaveLength(3);
    expect(new Set(enqueued.map((row) => row.ownerSub))).toEqual(new Set([APP_USER]));
    expect(enqueued.map((row) => JSON.parse(row.payload).dueDate)).toEqual([DAY, DAY, DAY]);
  });

  it("grants the origin in todo-service, forwarding the caller's bearer token", async () => {
    await enable({ enabled: true });

    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0].body).toEqual({ originService: MEAL_ORIGIN_SERVICE });
    // The token is forwarded, never exchanged for something this service made up.
    expect(grantCalls[0].authorization).toBe(`Bearer ${token}`);
  });

  it('keeps one toggle row when enabling twice', async () => {
    await enable({ enabled: true });
    await enable({ enabled: true });

    expect(await toggles()).toHaveLength(1);
  });

  it('deletes the toggle row and enqueues nothing new on disable', async () => {
    await enable({ enabled: true });
    const before = (await creates()).length;

    const response = await auth(request(server()).delete('/api/meal-todo'), token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false });
    expect(await toggles()).toEqual([]);
    expect((await creates()).length).toBe(before);
  });

  it('treats `enabled: false` exactly as DELETE', async () => {
    await enable({ enabled: true });

    const response = await enable({ enabled: false });

    expect(response.body).toEqual({ enabled: false });
    expect(await toggles()).toEqual([]);
  });

  it('reports the stored state on GET', async () => {
    const off = await auth(request(server()).get('/api/meal-todo'), token);
    await enable({ enabled: true });
    const on = await auth(request(server()).get('/api/meal-todo'), token);

    expect(off.body).toEqual({ enabled: false });
    expect(on.body).toEqual({ enabled: true });
  });

  it('answers 400 when the day is absent or malformed, and writes nothing', async () => {
    const missing = await auth(request(server()).post('/api/meal-todo'), token).send({
      enabled: true,
    });
    const malformed = await enable({ enabled: true }, '2026-9-3');

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(await toggles()).toEqual([]);
  });

  it('surfaces a refused grant instead of leaving an enabled toggle', async () => {
    // A toggle that says on while the hub refused the grant would produce intents
    // todo-service rejects forever — the one failure this route must not swallow.
    grantedStatus = 502;

    const response = await enable({ enabled: true });

    expect(response.status).toBe(502);
    expect(await creates()).toEqual([]);
  });

  it('states the disclosure sentence byte-for-byte', () => {
    expect(MEAL_TODO_DISCLOSURE).toBe(CANONICAL_DISCLOSURE);
  });
});
