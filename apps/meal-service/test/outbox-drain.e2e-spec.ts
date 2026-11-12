import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Outbox } from '../src/outbox/outbox.entity.js';
import { OUTBOX_ERROR_MAX_CHARS, OUTBOX_SWEEP_BATCH } from '../src/outbox/outbox-poller.service.js';
import { TODOS_CREATE } from '../src/outbox/producer/todo-intents.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * The drain routes (`GET /api/meal-todo/pending`, `POST /api/meal-todo/published`) —
 * the delivery leg the BFF walks with the user's own token.
 *
 * Both are owner-scoped from the verified token, never from a parameter: the pending
 * read is this owner's queue and nobody else's, and an id belonging to another owner
 * is ignored rather than refused, because whether it exists is not the caller's
 * business. One body reports a whole batch, carrying successes and failures together,
 * so a row that keeps failing is left visibly pending with the reason it stuck.
 *
 * Hermetic: a throwaway SQLite file, a local JWKS server, and no outbound call.
 */

const TEST_DB = join(import.meta.dirname, 'test-outbox-drain.db');

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

/** One pending row, with a `createdAt` the test controls so ordering is not a race. */
const intent = (overrides: Partial<Outbox> = {}): Partial<Outbox> => ({
  id: randomUUID(),
  ownerSub: OWNER,
  destination: TODOS_CREATE,
  payload: JSON.stringify({
    title: 'Eat Breakfast to reach 2200 kcal',
    originId: 'meal:breakfast',
  }),
  createdAt: new Date(),
  publishedAt: null,
  attempts: 0,
  lastError: null,
  ...overrides,
});

describe('Meal outbox drain (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let ownToken = '';
  let otherToken = '';

  const rows = () => dataSource.getRepository(Outbox);
  const seed = async (...intents: Array<Partial<Outbox>>) => {
    await rows().save(intents.map((row) => rows().create(intent(row))));
  };

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    ownToken = await harness.sign({ subject: OWNER });
    otherToken = await harness.sign({ subject: OTHER_OWNER });

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

  beforeEach(async () => {
    await rows().clear();
  });

  const server = () => app.getHttpServer();
  const pending = (token = ownToken) =>
    request(server()).get('/api/meal-todo/pending').set('Authorization', `Bearer ${token}`);
  const publish = (records: unknown[], token = ownToken) =>
    request(server())
      .post('/api/meal-todo/published')
      .set('Authorization', `Bearer ${token}`)
      .send({ records });

  it('returns only the caller’s unpublished intents, oldest first', async () => {
    await seed(
      { createdAt: new Date('2026-09-03T08:00:00Z') },
      { createdAt: new Date('2026-09-03T09:00:00Z') },
      { ownerSub: OTHER_OWNER },
      { publishedAt: new Date() },
    );

    const response = await pending();

    expect(response.status).toBe(200);
    expect(response.body.intents).toHaveLength(2);
    expect(
      response.body.intents.map((row: { payload: string }) => JSON.parse(row.payload)),
    ).toEqual([
      { title: 'Eat Breakfast to reach 2200 kcal', originId: 'meal:breakfast' },
      { title: 'Eat Breakfast to reach 2200 kcal', originId: 'meal:breakfast' },
    ]);
    // The payload is the exact todo-service body, served verbatim.
    expect(Object.keys(response.body.intents[0]).sort()).toEqual(['destination', 'id', 'payload']);
  });

  it('caps a read at one sweep batch, so a backlog cannot flood the deliverer', async () => {
    const many = Array.from({ length: OUTBOX_SWEEP_BATCH + 1 }, (_unused, index) =>
      intent({ createdAt: new Date(Date.UTC(2026, 8, 3, 0, index)) }),
    );
    await seed(...many);

    const response = await pending();

    expect(response.body.intents).toHaveLength(OUTBOX_SWEEP_BATCH);
  });

  it('publishes exactly the listed ids and clears their failure reason', async () => {
    const first = intent({ lastError: 'earlier failure' });
    const second = intent();
    await seed(first, second);

    const response = await publish([{ id: first.id, published: true }]);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ updated: 1 });
    const stored = await rows().findOneByOrFail({ id: first.id as string });
    expect(stored.publishedAt).toBeInstanceOf(Date);
    expect(stored.lastError).toBeNull();
    expect((await rows().findOneByOrFail({ id: second.id as string })).publishedAt).toBeNull();
  });

  it('ignores another owner’s id silently rather than reporting it', async () => {
    const foreign = intent({ ownerSub: OTHER_OWNER });
    await seed(foreign);

    const response = await publish([{ id: foreign.id, published: true }]);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ updated: 0 });
    expect((await rows().findOneByOrFail({ id: foreign.id as string })).publishedAt).toBeNull();
  });

  it('leaves a failed row pending with its reason and one more attempt', async () => {
    const failing = intent();
    await seed(failing);

    await publish([{ id: failing.id, published: false, lastError: 'todos answered 500' }]);

    const stored = await rows().findOneByOrFail({ id: failing.id as string });
    expect(stored.publishedAt).toBeNull();
    expect(stored.lastError).toBe('todos answered 500');
    expect(stored.attempts).toBe(1);
  });

  it('closes a revoked row: published, with the reason kept for diagnosis', async () => {
    const revoked = intent();
    await seed(revoked);

    await publish([{ id: revoked.id, published: true, lastError: 'rejected by todos: 403' }]);

    const stored = await rows().findOneByOrFail({ id: revoked.id as string });
    expect(stored.publishedAt).toBeInstanceOf(Date);
    expect(stored.lastError).toBe('rejected by todos: 403');
  });

  it('does not hand a published row back on the next read', async () => {
    const done = intent();
    await seed(done);

    await publish([{ id: done.id, published: true }]);
    const response = await pending();

    expect(response.body.intents).toEqual([]);
  });

  it('flattens and caps a long failure reason to one column-sized line', async () => {
    const failing = intent();
    await seed(failing);

    await publish([
      { id: failing.id, published: false, lastError: `line one\nline two ${'x'.repeat(400)}` },
    ]);

    const stored = await rows().findOneByOrFail({ id: failing.id as string });
    expect(stored.lastError).toHaveLength(OUTBOX_ERROR_MAX_CHARS);
    expect(stored.lastError).not.toContain('\n');
  });

  it('rejects a batch larger than one read can have handed out', async () => {
    const records = Array.from({ length: OUTBOX_SWEEP_BATCH + 1 }, () => ({
      id: randomUUID(),
      published: true,
    }));

    expect((await publish(records)).status).toBe(400);
  });

  it('rejects an outcome that names nothing to write', async () => {
    expect((await publish([{ published: true }])).status).toBe(400);
  });

  it('answers 401 without a token, so neither route is reachable unauthenticated', async () => {
    const [read, write] = await Promise.all([
      request(server()).get('/api/meal-todo/pending'),
      request(server()).post('/api/meal-todo/published').send({ records: [] }),
    ]);

    expect([read.status, write.status]).toEqual([401, 401]);
  });

  it('keeps the day’s enable routes working alongside the drain routes', async () => {
    const response = await request(server())
      .get('/api/meal-todo')
      .set('Authorization', `Bearer ${otherToken}`);

    // `pending` must not shadow the parameterless state read on the same prefix.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false });
  });
});
