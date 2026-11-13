import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENC_PREFIX } from '@life/crypto';
import { OriginGrant, type Principal } from '@life/service-kit';
import { Todo } from '../src/todos/todo.entity.js';
import { generationKey, TodosCache } from '../src/cache/todo-cache.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';
import { FakeRedisClient } from './fake-redis.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `POST /api/todos/origin/:originId/rename` — the title refresh a producer needs
 * when the owner's calorie target changes (`SPEC-todo-origin` §9.15 follow-up).
 *
 * The requirement, not the mechanism: an **open** task takes the new number, and a
 * **done** task is byte-identical after a refused rename — a finished task is a
 * record of what the owner did, and rewriting it would falsify that record.
 *
 * Boots the real Nest app (global `AuthGuard`, real IdP-JWKS verification, real
 * sqlite DB), so authorization is the verified token's, exactly as in production.
 */

const TEST_DB = join(import.meta.dirname, 'test-origin-rename.db');

const BASE_NODE_ENV = 'test';
const PRODUCER_A = 'producer-a';
const GRANTED_ORIGIN = 'meal-service';
const APP_USER = 'user-a';
const OTHER_USER = 'user-b';
const OTHER_GRANTED_ORIGIN = 'calendar-service';

let tokenWithGrant = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Origin rename (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    tokenWithGrant = await harness.sign({ subject: APP_USER, clientId: PRODUCER_A });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.getRepository(OriginGrant).insert([
      {
        ownerSub: APP_USER,
        clientId: PRODUCER_A,
        direction: 'write',
        originService: GRANTED_ORIGIN,
        grantedAt: new Date(),
      },
      {
        ownerSub: OTHER_USER,
        clientId: PRODUCER_A,
        direction: 'write',
        originService: OTHER_GRANTED_ORIGIN,
        grantedAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const server = () => app.getHttpServer();
  const createWithOrigin = (body: Record<string, unknown>, token = tokenWithGrant) =>
    auth(request(server()).post('/api/todos/origin'), token).send(body);
  const renameByOrigin = (
    originId: string,
    body: Record<string, unknown>,
    token = tokenWithGrant,
  ) => auth(request(server()).post(`/api/todos/origin/${originId}/rename`), token).send(body);
  const rowOf = async (originId: string): Promise<Todo> =>
    dataSource.getRepository(Todo).findOneByOrFail({ originId });

  it('gives an open task the new title, stored as ciphertext', async () => {
    await createWithOrigin({ title: 'Eat Breakfast to reach 2200 kcal', originId: 'r-open-1' });

    const renamed = await renameByOrigin('r-open-1', {
      title: 'Eat Breakfast to reach 2500 kcal',
    });

    expect(renamed.status).toBe(201);
    expect(renamed.body.title).toBe('Eat Breakfast to reach 2500 kcal');
    expect(renamed.body.done).toBe(false);
    expect(renamed.body.originId).toBe('r-open-1');

    const row = await rowOf('r-open-1');
    // Sealed under the owner's key exactly like a create: never plaintext at rest.
    expect(row.title.startsWith(ENC_PREFIX)).toBe(true);
    expect(row.title).not.toContain('2500');
    expect(row.title).not.toContain('Breakfast');
  });

  it('refuses a done task with 409 and leaves its title and version untouched', async () => {
    await createWithOrigin({ title: 'Eat Lunch to reach 2200 kcal', originId: 'r-done-1' });
    // Logging closes a non-repeating task: after this the row is history.
    await auth(request(server()).post('/api/todos/origin/r-done-1/complete'), tokenWithGrant);
    const before = await rowOf('r-done-1');
    expect(before.done).toBe(true);

    const refused = await renameByOrigin('r-done-1', { title: 'Eat Lunch to reach 3000 kcal' });

    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('cannot rename a completed todo');
    const after = await rowOf('r-done-1');
    // Byte-identical: the refused rename wrote nothing at all.
    expect(after.title).toBe(before.title);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after).toEqual(before);
  });

  it("answers another origin's id with the same 404 a missing one gets", async () => {
    await createWithOrigin({ title: 'Eat Dinner to reach 2200 kcal', originId: 'r-404-1' });
    const before = await rowOf('r-404-1');

    // A second owner granted the same producer client a different origin: this id
    // exists, but not for them, so the answer must not admit that it exists.
    const otherToken = await harness.sign({ subject: OTHER_USER, clientId: PRODUCER_A });
    const foreign = await renameByOrigin('r-404-1', { title: 'stolen title' }, otherToken);
    const missing = await renameByOrigin('r-never-existed', { title: 'stolen title' }, otherToken);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect((await rowOf('r-404-1')).title).toBe(before.title);
  });

  it('rejects a body with no title, so a rename that would do nothing is refused', async () => {
    await createWithOrigin({ title: 'Eat Breakfast to reach 2200 kcal', originId: 'r-empty-1' });
    const before = await rowOf('r-empty-1');

    const response = await renameByOrigin('r-empty-1', {});

    expect(response.status).toBe(400);
    expect((await rowOf('r-empty-1')).title).toBe(before.title);
  });
});

/**
 * Contract 2 at the rename seam: a rename is a write, so it invalidates this
 * owner's read set; a refused rename is not, so it must not. Asserted over the
 * real read-through cache rather than over a spy, because "a subsequent read sees
 * the new title" is the requirement — a bump count alone could be satisfied by a
 * bump that invalidated the wrong key.
 */
describe('Origin rename and the cache generation (Contract 2)', () => {
  let h: UnitHarness;
  let client: FakeRedisClient;

  beforeEach(async () => {
    client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.dataSource.getRepository(OriginGrant).insert({
      ownerSub: SUB,
      clientId: PRODUCER_A,
      direction: 'write',
      originService: GRANTED_ORIGIN,
      grantedAt: new Date(),
    });
  });

  afterEach(async () => {
    await h.dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  const producer = (): Principal => ({ sub: SUB, clientId: PRODUCER_A });
  const generation = (): number =>
    Number.parseInt(client.store.get(generationKey(SUB)) ?? '0', 10) || 0;

  it('bumps once on a rename, and the next read sees the new title', async () => {
    await h.todos.createWithOrigin(producer(), { title: 'old number', originId: 'c-open-1' });
    // Warm the cached row-set: the read after the rename is the one that has to
    // notice, not a fresh loader call.
    expect((await h.todos.findAll(SUB, {})).todos[0].title).toBe('old number');
    const before = generation();

    await h.todos.renameByOrigin(producer(), 'c-open-1', { title: 'new number' });

    expect(generation()).toBe(before + 1);
    expect((await h.todos.findAll(SUB, {})).todos[0].title).toBe('new number');
  });

  it('bumps nothing when the todo is done, and the stored title still reads', async () => {
    await h.todos.createWithOrigin(producer(), { title: 'old number', originId: 'c-done-1' });
    const [open] = (await h.todos.findAll(SUB, {})).todos;
    await h.todos.update(SUB, open.id, { done: true });
    const before = generation();

    await expect(
      h.todos.renameByOrigin(producer(), 'c-done-1', { title: 'new number' }),
    ).rejects.toThrow('cannot rename a completed todo');

    expect(generation()).toBe(before);
    expect((await h.todos.findAll(SUB, {})).todos[0].title).toBe('old number');
  });
});
