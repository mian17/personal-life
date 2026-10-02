import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * Two-subject ownership isolation for the todo trash verbs (plan-todo-trash T4).
 * Boots the real app with the real guard and drives it over HTTP for two
 * independently minted subjects A and B: every query is scoped by the verified
 * `sub`, and a foreign id is indistinguishable from a missing one (byte-identical
 * 404) on restore/permanent; `emptyTrash` only ever empties the caller's rows.
 *
 * `NODE_ENV` is pinned to a non-development value for the whole suite (jest
 * workers share `process.env`, and the guard's dev bypass reads it per request);
 * only the dedicated dev case flips it, restoring it immediately after.
 */

const TEST_DB = join(__dirname, 'test-ownership.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Todos ownership (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    tokenA = await harness.sign({ subject: 'user-a', expiresIn: 3600 });
    tokenB = await harness.sign({ subject: 'user-b', expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterEach(() => {
    // The dev bypass must never leak into a later case in this worker.
    process.env.NODE_ENV = BASE_NODE_ENV;
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const post = (body: Record<string, unknown>, token: string) =>
    auth(request(app.getHttpServer()).post('/api/todos'), token).send(body);
  const list = (token: string) =>
    auth(request(app.getHttpServer()).get('/api/todos'), token);
  const trash = (token: string) =>
    auth(request(app.getHttpServer()).get('/api/todos/trash'), token);
  const tags = (token: string) =>
    auth(request(app.getHttpServer()).get('/api/todos/tags'), token);
  const remove = (id: string, token: string) =>
    auth(request(app.getHttpServer()).delete(`/api/todos/${id}`), token);
  const restore = (id: string, token: string) =>
    auth(request(app.getHttpServer()).post(`/api/todos/${id}/restore`), token);
  const removePermanent = (id: string, token: string) =>
    auth(request(app.getHttpServer()).delete(`/api/todos/${id}/permanent`), token);
  const emptyTrash = (token: string) =>
    auth(request(app.getHttpServer()).delete('/api/todos/trash'), token);

  it('scopes list and trash to the caller (B sees nothing of A)', async () => {
    const active = await post({ title: 'a-active' }, tokenA).expect(201);
    const trashed = await post({ title: 'a-trashed' }, tokenA).expect(201);
    await remove(trashed.body.id, tokenA).expect(200);

    // First case in the suite: B has created nothing, so B's world is empty.
    const bList = await list(tokenB).expect(200);
    expect(bList.body.todos).toEqual([]);
    const bTrash = await trash(tokenB).expect(200);
    expect(bTrash.body.todos).toEqual([]);

    const aList = await list(tokenA).expect(200);
    const aIds = aList.body.todos.map((t: { id: string }) => t.id);
    expect(aIds).toContain(active.body.id);
    expect(aIds).not.toContain(trashed.body.id);

    const aTrash = await trash(tokenA).expect(200);
    expect(aTrash.body.todos.map((t: { id: string }) => t.id)).toContain(trashed.body.id);
  });

  it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
    const active = await post({ title: 'foreign-active' }, tokenA).expect(201);
    const trashed = await post({ title: 'foreign-trashed' }, tokenA).expect(201);
    await remove(trashed.body.id, tokenA).expect(200);

    const compare404 = async (foreign: () => request.Test, missing: () => request.Test) => {
      const f = await foreign().expect(404);
      const m = await missing().expect(404);
      expect(f.status).toBe(m.status);
      expect(f.status).not.toBe(403);
      expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
    };

    await compare404(
      () => auth(request(app.getHttpServer()).get(`/api/todos/${active.body.id}`), tokenB),
      () => auth(request(app.getHttpServer()).get(`/api/todos/${MISSING_ID}`), tokenB),
    );
    await compare404(
      () =>
        auth(request(app.getHttpServer()).patch(`/api/todos/${active.body.id}`), tokenB).send({
          title: 'hijack',
        }),
      () =>
        auth(request(app.getHttpServer()).patch(`/api/todos/${MISSING_ID}`), tokenB).send({
          title: 'hijack',
        }),
    );
    await compare404(
      () => remove(active.body.id, tokenB),
      () => remove(MISSING_ID, tokenB),
    );
    await compare404(
      () => restore(trashed.body.id, tokenB),
      () => restore(MISSING_ID, tokenB),
    );
    await compare404(
      () => removePermanent(trashed.body.id, tokenB),
      () => removePermanent(MISSING_ID, tokenB),
    );

    // B's failed attempts never touched A's rows.
    const reread = await auth(
      request(app.getHttpServer()).get(`/api/todos/${active.body.id}`),
      tokenA,
    ).expect(200);
    expect(reread.body.title).toBe('foreign-active');
    const aTrash = await trash(tokenA).expect(200);
    expect(aTrash.body.todos.map((t: { id: string }) => t.id)).toContain(trashed.body.id);
  });

  it("empties only the caller's trash", async () => {
    const a1 = await post({ title: 'empty-a1' }, tokenA).expect(201);
    const b1 = await post({ title: 'empty-b1' }, tokenB).expect(201);
    await remove(a1.body.id, tokenA).expect(200);
    await remove(b1.body.id, tokenB).expect(200);

    const bEmptied = await emptyTrash(tokenB).expect(200);
    expect(bEmptied.body.ok).toBe(true);
    expect(bEmptied.body.count).toBeGreaterThanOrEqual(1);

    // A's trashed todo survives B's emptyTrash.
    const aTrashAfterB = await trash(tokenA).expect(200);
    expect(aTrashAfterB.body.todos.map((t: { id: string }) => t.id)).toContain(a1.body.id);
    const bTrashAfterB = await trash(tokenB).expect(200);
    expect(bTrashAfterB.body.todos).toEqual([]);

    // ...and the reverse: A's emptyTrash does not remove B's trash.
    const a2 = await post({ title: 'empty-a2' }, tokenA).expect(201);
    const b2 = await post({ title: 'empty-b2' }, tokenB).expect(201);
    await remove(a2.body.id, tokenA).expect(200);
    await remove(b2.body.id, tokenB).expect(200);

    await emptyTrash(tokenA).expect(200);

    const bTrashAfterA = await trash(tokenB).expect(200);
    expect(bTrashAfterA.body.todos.map((t: { id: string }) => t.id)).toContain(b2.body.id);
    const aTrashAfterA = await trash(tokenA).expect(200);
    expect(aTrashAfterA.body.todos).toEqual([]);
  });

  it("stamps the caller's sub on create (invisible to another subject)", async () => {
    const created = await post({ title: 'owned-by-a' }, tokenA).expect(201);

    const byA = await auth(
      request(app.getHttpServer()).get(`/api/todos/${created.body.id}`),
      tokenA,
    ).expect(200);
    expect(byA.body.id).toBe(created.body.id);

    await auth(
      request(app.getHttpServer()).get(`/api/todos/${created.body.id}`),
      tokenB,
    ).expect(404);
  });

  it('stamps dev-user when NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    try {
      // No token: the dev bypass authenticates the request as `dev-user`.
      await request(app.getHttpServer()).post('/api/todos').send({ title: 'dev-owned' }).expect(201);
    } finally {
      process.env.NODE_ENV = BASE_NODE_ENV;
    }

    // Readable under `dev-user`'s verified token, invisible to user A.
    const devToken = await harness.sign({ subject: 'dev-user', expiresIn: 3600 });
    const devList = await list(devToken).expect(200);
    expect(devList.body.todos.map((t: { title: string }) => t.title)).toContain('dev-owned');

    const aList = await list(tokenA).expect(200);
    expect(aList.body.todos.map((t: { title: string }) => t.title)).not.toContain('dev-owned');
  });

  it('serializes no owner field in the TodoDto (list and get)', async () => {
    const todoKeys = [
      'createdAt',
      'deletedAt',
      'done',
      'dueDate',
      'effectiveImportant',
      'id',
      'important',
      'listId',
      'note',
      'reminderScheduledAt',
      'repeat',
      'tagIds',
      'title',
      'updatedAt',
      'version',
    ].sort();

    const created = await post({ title: 'shape-check', tagIds: [5] }, tokenA).expect(201);
    const fetched = await auth(
      request(app.getHttpServer()).get(`/api/todos/${created.body.id}`),
      tokenA,
    ).expect(200);

    expect(fetched.body).not.toHaveProperty('owner');
    expect(fetched.body).not.toHaveProperty('ownerSub');
    expect(Object.keys(fetched.body).sort()).toEqual(todoKeys);
    expect(fetched.body.tagIds).toEqual([5]);

    const listed = await list(tokenA).expect(200);
    const item = listed.body.todos.find((t: { id: string }) => t.id === created.body.id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('owner');
    expect(item).not.toHaveProperty('ownerSub');
    expect(Object.keys(item).sort()).toEqual(todoKeys);
  });

  it('preserves the full owner lifecycle (create/list/update/trash/restore)', async () => {
    const created = await post({ title: 'lifecycle', tagIds: [11] }, tokenA).expect(201);
    const id = created.body.id;
    expect(created.body.version).toBe(0);

    const listed = await list(tokenA).expect(200);
    expect(listed.body.todos.map((t: { id: string }) => t.id)).toContain(id);

    const updated = await auth(
      request(app.getHttpServer()).patch(`/api/todos/${id}`),
      tokenA,
    )
      .send({ title: 'lifecycle edited', expectedVersion: 0 })
      .expect(200);
    expect(updated.body.title).toBe('lifecycle edited');
    expect(updated.body.version).toBe(1);

    await remove(id, tokenA).expect(200);
    await auth(request(app.getHttpServer()).get(`/api/todos/${id}`), tokenA).expect(404);

    const trashed = await trash(tokenA).expect(200);
    expect(trashed.body.todos.map((t: { id: string }) => t.id)).toContain(id);

    const restored = await restore(id, tokenA).expect(201);
    expect(restored.body.title).toBe('lifecycle edited');
    expect(restored.body.deletedAt).toBeNull();
    expect(restored.body.tagIds).toEqual([11]);
  });

  it("scopes the tag usage surface to the caller (A's registry ids never appear to B)", async () => {
    await post({ title: 'iso-a', tagIds: [101] }, tokenA).expect(201);
    await post({ title: 'iso-b', tagIds: [202] }, tokenB).expect(201);

    const aTags = await tags(tokenA).expect(200);
    const aIds = aTags.body.map((t: { tagId: number }) => t.tagId);
    expect(aIds).toContain(101);
    expect(aIds).not.toContain(202);

    const bTags = await tags(tokenB).expect(200);
    const bIds = bTags.body.map((t: { tagId: number }) => t.tagId);
    expect(bIds).toContain(202);
    expect(bIds).not.toContain(101);
  });
});
