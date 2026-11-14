import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Todo } from '../src/todos/todo.entity.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `SPEC-todo-service` Behaviour/API — the todo domain over HTTP.
 *
 * Boots the real Nest app (global `AuthGuard`, real IdP-JWKS verification, real
 * sqlite DB) and drives every endpoint with independently minted subjects. Every
 * fixture DB is a throwaway under `test/`; this suite NEVER opens anything under
 * `apps/todo-service/data/` (the hard line).
 *
 * Ordering fixtures are isolated by a per-test list (`?listId=`) so pinned
 * `createdAt` values cannot leak between cases.
 */

const TEST_DB = join(import.meta.dirname, 'test-todos.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Todos API (e2e)', () => {
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
    tokenA = await harness.sign({ subject: 'user-a', expiresIn: 3600 });
    tokenB = await harness.sign({ subject: 'user-b', expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    process.env.NODE_ENV = BASE_NODE_ENV;
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const server = () => app.getHttpServer();
  const list = (query = '', token = tokenA) =>
    auth(request(server()).get(`/api/todos${query}`), token);
  const create = (body: Record<string, unknown>, token = tokenA) =>
    auth(request(server()).post('/api/todos'), token).send(body);
  const getOne = (id: string, token = tokenA) =>
    auth(request(server()).get(`/api/todos/${id}`), token);
  const patch = (id: string, body: Record<string, unknown>, token = tokenA) =>
    auth(request(server()).patch(`/api/todos/${id}`), token).send(body);
  const remove = (id: string, token = tokenA) =>
    auth(request(server()).delete(`/api/todos/${id}`), token);
  const trash = (token = tokenA) => auth(request(server()).get('/api/todos/trash'), token);
  const restore = (id: string, token = tokenA) =>
    auth(request(server()).post(`/api/todos/${id}/restore`), token);
  const removePermanent = (id: string, token = tokenA) =>
    auth(request(server()).delete(`/api/todos/${id}/permanent`), token);
  const emptyTrash = (token = tokenA) => auth(request(server()).delete('/api/todos/trash'), token);
  const tags = (token = tokenA) => auth(request(server()).get('/api/todos/tags'), token);
  const createList = (name: string, token = tokenA) =>
    auth(request(server()).post('/api/lists'), token).send({ name });

  const pinCreatedAt = (id: string, when: Date) =>
    dataSource.getRepository(Todo).update(id, { createdAt: when, updatedAt: when });

  describe('auth', () => {
    it('rejects a missing token on every todo surface', async () => {
      await request(server()).get('/api/todos').expect(401);
      await request(server()).get('/api/todos/tags').expect(401);
      await request(server()).post('/api/todos').send({ title: 'x' }).expect(401);
      await request(server()).get('/api/lists').expect(401);
    });

    it('rejects a garbage bearer token', async () => {
      const res = await auth(request(server()).get('/api/todos'), 'not-a-jwt').expect(401);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/todos', () => {
    it('creates a todo with version 0 and the exact DTO key set', async () => {
      const created = await create({ title: 'buy milk', note: 'semi-skimmed' }).expect(201);

      expect(Object.keys(created.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
        'createdAt',
        'deletedAt',
        'done',
        'dueDate',
        'effectiveImportant',
        'id',
        'important',
        'listId',
        'note',
        'originService',
        'reminderScheduledAt',
        'repeat',
        'repeatDays',
        'tagIds',
        'title',
        'updatedAt',
        'version',
      ]);
      expect(created.body).toMatchObject({
        title: 'buy milk',
        note: 'semi-skimmed',
        done: false,
        important: null,
        effectiveImportant: false,
        dueDate: null,
        listId: null,
        tagIds: [],
        version: 0,
      });
      expect(typeof created.body.id).toBe('string');
      expect(created.body.createdAt.endsWith('Z')).toBe(true);
    });

    it('accepts a dueDate, listId and tagIds', async () => {
      const l = await createList('Errands').expect(201);
      const created = await create({
        title: 'with metadata',
        dueDate: '2026-10-01',
        listId: l.body.id,
        tagIds: [7, 3, 7],
      }).expect(201);

      expect(created.body.dueDate).toBe('2026-10-01');
      expect(created.body.listId).toBe(l.body.id);
      expect(created.body.tagIds).toEqual([3, 7]);
    });

    it('rejects an empty title and a malformed dueDate (400)', async () => {
      const emptyTitle = await create({ title: '' }).expect(400);
      expect(emptyTitle.status).toBe(400);
      const badDate = await create({ title: 'bad date', dueDate: '01-10-2026' }).expect(400);
      expect(badDate.status).toBe(400);
      const missingTitle = await create({}).expect(400);
      expect(missingTitle.status).toBe(400);
    });

    it('rejects a foreign/unknown listId with a 404 (never a raw FK failure)', async () => {
      const l = await createList('B-only', tokenB).expect(201);
      const foreign = await create({ title: 'cross-list', listId: l.body.id }, tokenA).expect(404);
      expect(foreign.status).toBe(404);
      const missing = await create({ title: 'missing-list', listId: MISSING_ID }).expect(404);
      expect(missing.status).toBe(404);
    });
  });

  describe('GET /api/todos', () => {
    it('returns owner-scoped todos in the domain order (dated ASC, undated last, createdAt DESC)', async () => {
      const l = await createList('Ordering').expect(201);
      const base = Date.parse('2026-05-05T00:00:00Z');

      const undatedOld = await create({ title: 'undated-old', listId: l.body.id }).expect(201);
      const undatedNew = await create({ title: 'undated-new', listId: l.body.id }).expect(201);
      const later = await create({
        title: 'due-later',
        dueDate: '2026-06-01',
        listId: l.body.id,
      }).expect(201);
      const overdue = await create({
        title: 'due-overdue',
        dueDate: '2026-01-01',
        listId: l.body.id,
      }).expect(201);
      const today = await create({
        title: 'due-today',
        dueDate: '2026-03-03',
        listId: l.body.id,
      }).expect(201);

      // Pin createdAt to make the undated/createdAt tiebreak deterministic.
      await pinCreatedAt(undatedOld.body.id, new Date(base));
      await pinCreatedAt(undatedNew.body.id, new Date(base + 1000));

      const res = await list(`?listId=${l.body.id}`).expect(200);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.todos.map((t: { id: string }) => t.id)).toEqual([
        overdue.body.id,
        today.body.id,
        later.body.id,
        undatedNew.body.id,
        undatedOld.body.id,
      ]);
    });

    it('filters by done, dueBefore/dueAfter, listId, tagId and q, all post-decrypt', async () => {
      const l = await createList('Filters').expect(201);
      const a = await create({
        title: 'filter alpha',
        dueDate: '2026-02-02',
        listId: l.body.id,
        tagIds: [1],
      }).expect(201);
      const b = await create({
        title: 'filter beta',
        dueDate: '2026-04-04',
        listId: l.body.id,
        tagIds: [2],
      }).expect(201);
      const c = await create({ title: 'filter gamma', listId: l.body.id, tagIds: [1, 2] }).expect(
        201,
      );
      await patch(b.body.id, { done: true }).expect(200);

      const byDone = await list(`?listId=${l.body.id}&done=false`).expect(200);
      expect(
        byDone.body.todos
          .map((t: { id: string }) => t.id)
          .sort((a: string, b: string) => a.localeCompare(b)),
      ).toEqual([a.body.id, c.body.id].sort((a: string, b: string) => a.localeCompare(b)));

      const byDueBefore = await list(`?listId=${l.body.id}&dueBefore=2026-03-03`).expect(200);
      expect(byDueBefore.body.todos.map((t: { id: string }) => t.id)).toEqual([a.body.id]);

      const byDueAfter = await list(`?listId=${l.body.id}&dueAfter=2026-03-03`).expect(200);
      expect(byDueAfter.body.todos.map((t: { id: string }) => t.id)).toEqual([b.body.id]);

      const byTag = await list(`?listId=${l.body.id}&tagId=2`).expect(200);
      expect(
        byTag.body.todos
          .map((t: { id: string }) => t.id)
          .sort((a: string, b: string) => a.localeCompare(b)),
      ).toEqual([b.body.id, c.body.id].sort((a: string, b: string) => a.localeCompare(b)));

      const byQ = await list(`?listId=${l.body.id}&q=ALPHA`).expect(200);
      expect(byQ.body.todos.map((t: { id: string }) => t.id)).toEqual([a.body.id]);

      const byList = await list(`?listId=${l.body.id}`).expect(200);
      expect(byList.body.todos).toHaveLength(3);
    });

    it('pages with cursor continuity and no dup/skip across a createdAt tie', async () => {
      const l = await createList('Paging').expect(201);
      const same = new Date('2026-07-07T00:00:00Z');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const created = await create({
          title: `page todo ${i}`,
          dueDate: '2026-07-07',
          listId: l.body.id,
        }).expect(201);
        ids.push(created.body.id);
        await pinCreatedAt(created.body.id, same);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const query = `?listId=${l.body.id}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await list(query).expect(200);
        expect(Object.keys(res.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
          'nextCursor',
          'todos',
          'total',
        ]);
        seen.push(...res.body.todos.map((t: { id: string }) => t.id));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 10);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen).toEqual([...ids].sort((a: string, b: string) => a.localeCompare(b)).reverse());
    });

    it('pages across the dated/undated boundary without repeating the boundary row', async () => {
      const l = await createList('Boundary').expect(201);
      const same = new Date('2026-08-08T00:00:00Z');
      const dated = await create({
        title: 'the dated one',
        dueDate: '2026-01-01',
        listId: l.body.id,
      }).expect(201);
      const u1 = await create({ title: 'undated 1', listId: l.body.id }).expect(201);
      const u2 = await create({ title: 'undated 2', listId: l.body.id }).expect(201);
      await pinCreatedAt(dated.body.id, same);
      await pinCreatedAt(u1.body.id, new Date(same.getTime() + 1000));
      await pinCreatedAt(u2.body.id, new Date(same.getTime() + 2000));

      // Undated rows order by createdAt DESC, so u2 (newer) precedes u1.
      const first = await list(`?listId=${l.body.id}&limit=2`).expect(200);
      expect(first.body.todos.map((t: { id: string }) => t.id)).toEqual([
        dated.body.id,
        u2.body.id,
      ]);
      expect(first.body.nextCursor).not.toBeNull();

      const second = await list(
        `?listId=${l.body.id}&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      ).expect(200);
      expect(second.body.todos.map((t: { id: string }) => t.id)).toEqual([u1.body.id]);
      expect(second.body.nextCursor).toBeNull();
    });

    it("scopes every query to the caller (B never sees A's todos)", async () => {
      await create({ title: 'a-only-visible' }, tokenA).expect(201);
      await create({ title: 'b-only-visible' }, tokenB).expect(201);

      const aNames = (await list('', tokenA).expect(200)).body.todos.map(
        (t: { title: string }) => t.title,
      );
      const bNames = (await list('', tokenB).expect(200)).body.todos.map(
        (t: { title: string }) => t.title,
      );
      expect(aNames).toContain('a-only-visible');
      expect(aNames).not.toContain('b-only-visible');
      expect(bNames).toContain('b-only-visible');
      expect(bNames).not.toContain('a-only-visible');
    });
  });

  describe('GET /api/todos/tags (declared before :id)', () => {
    it('returns [{tagId, count}] metadata, never shadowed by the :id route', async () => {
      await create({ title: 'tag-usage-1', tagIds: [11] }).expect(201);
      await create({ title: 'tag-usage-2', tagIds: [11, 22] }).expect(201);

      const res = await tags().expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      const eleven = res.body.find((r: { tagId: number }) => r.tagId === 11);
      const twentyTwo = res.body.find((r: { tagId: number }) => r.tagId === 22);
      expect(eleven.count).toBe(2);
      expect(twentyTwo.count).toBe(1);
      // Ids + counts only — no names, no content.
      expect(Object.keys(eleven).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
        'count',
        'tagId',
      ]);
    });

    it('drops a tag from the usage surface once its last todo is deleted', async () => {
      const created = await create({ title: 'sole-33', tagIds: [33] }).expect(201);
      expect((await tags().expect(200)).body.some((r: { tagId: number }) => r.tagId === 33)).toBe(
        true,
      );

      await remove(created.body.id).expect(200);
      expect((await tags().expect(200)).body.some((r: { tagId: number }) => r.tagId === 33)).toBe(
        false,
      );
    });
  });

  describe('GET/PATCH/DELETE /api/todos/:id', () => {
    it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
      const foreign = await create({ title: 'foreign-target' }, tokenA).expect(201);

      const compare404 = async (foreignReq: () => request.Test, missingReq: () => request.Test) => {
        const f = await foreignReq().expect(404);
        const m = await missingReq().expect(404);
        expect(f.status).toBe(m.status);
        expect(f.status).not.toBe(403);
        expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
      };

      await compare404(
        () => getOne(foreign.body.id, tokenB),
        () => getOne(MISSING_ID, tokenB),
      );
      await compare404(
        () => patch(foreign.body.id, { title: 'hijack' }, tokenB),
        () => patch(MISSING_ID, { title: 'hijack' }, tokenB),
      );
      await compare404(
        () => remove(foreign.body.id, tokenB),
        () => remove(MISSING_ID, tokenB),
      );

      // A's row was untouched.
      expect((await getOne(foreign.body.id, tokenA).expect(200)).body.title).toBe('foreign-target');
    });

    it('applies a partial update and increments version', async () => {
      const created = await create({
        title: 'before',
        note: 'old note',
        dueDate: '2026-02-02',
      }).expect(201);

      const updated = await patch(created.body.id, { title: 'after', done: true }).expect(200);
      expect(updated.body).toMatchObject({
        title: 'after',
        note: 'old note',
        done: true,
        dueDate: '2026-02-02',
        version: 1,
      });
    });

    it('clears note/dueDate/listId with an explicit null', async () => {
      const l = await createList('Clearing').expect(201);
      const created = await create({
        title: 'clear me',
        note: 'x',
        dueDate: '2026-02-02',
        listId: l.body.id,
      }).expect(201);

      const updated = await patch(created.body.id, {
        note: null,
        dueDate: null,
        listId: null,
      }).expect(200);
      expect(updated.body).toMatchObject({ note: null, dueDate: null, listId: null });
    });

    it('rejects a stale expectedVersion with 409 and leaves the row unchanged', async () => {
      const created = await create({ title: 'optimistic' }).expect(201);
      const first = await patch(created.body.id, {
        title: 'optimistic 1',
        expectedVersion: 0,
      }).expect(200);
      expect(first.body.version).toBe(1);

      await patch(created.body.id, { title: 'optimistic stale', expectedVersion: 0 }).expect(409);

      const reread = await getOne(created.body.id).expect(200);
      expect(reread.body).toMatchObject({ title: 'optimistic 1', version: 1 });
    });

    it('still updates without expectedVersion (last-write-wins)', async () => {
      const created = await create({ title: 'lww' }).expect(201);
      await patch(created.body.id, { title: 'lww one' }).expect(200);
      const second = await patch(created.body.id, { title: 'lww two' }).expect(200);
      expect(second.body).toMatchObject({ title: 'lww two', version: 2 });
    });

    it('soft-deletes: the todo moves to trash and vanishes from list, GET /:id and PATCH', async () => {
      const created = await create({ title: 'trash me', tagIds: [44] }).expect(201);
      const id = created.body.id;

      const removed = await remove(id).expect(200);
      expect(removed.body).toEqual({ ok: true });

      const listed = await list().expect(200);
      expect(listed.body.todos.map((t: { id: string }) => t.id)).not.toContain(id);
      await getOne(id).expect(404);
      await patch(id, { title: 'nope' }).expect(404);

      const inTrash = await trash().expect(200);
      const row = inTrash.body.todos.find((t: { id: string }) => t.id === id);
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
    });

    it('restores the trashed todo with the same createdAt, tags and version', async () => {
      const created = await create({ title: 'restore me', tagIds: [55] }).expect(201);
      const id = created.body.id;

      const updated = await patch(id, { title: 'restore me edited' }).expect(200);
      expect(updated.body.version).toBe(1);

      await remove(id).expect(200);
      const restored = await restore(id).expect(201);
      expect(restored.body.createdAt).toBe(created.body.createdAt);
      expect(restored.body.tagIds).toEqual([55]);
      expect(restored.body.version).toBe(1);
      expect(restored.body.deletedAt).toBeNull();

      const listed = await list().expect(200);
      expect(listed.body.todos.map((t: { id: string }) => t.id)).toContain(id);
    });

    it('never changes version on trash or restore', async () => {
      const created = await create({ title: 'version stable' }).expect(201);
      const id = created.body.id;
      expect(created.body.version).toBe(0);

      await remove(id).expect(200);
      const inTrash = await trash().expect(200);
      const row = inTrash.body.todos.find((t: { id: string }) => t.id === id);
      expect(row.version).toBe(0);

      const restored = await restore(id).expect(201);
      expect(restored.body.version).toBe(0);
    });

    it('permanently deletes the trashed todo (row and todo_tag) and 404s on a second call', async () => {
      const created = await create({ title: 'gone forever', tagIds: [44] }).expect(201);
      const id = created.body.id;
      await remove(id).expect(200);

      const gone = await removePermanent(id).expect(200);
      expect(gone.body).toEqual({ ok: true });

      const row = await dataSource.query('SELECT COUNT(*) AS c FROM todo WHERE id = ?', [id]);
      expect(Number(row[0].c)).toBe(0);
      const assoc = await dataSource.query('SELECT COUNT(*) AS c FROM todo_tag WHERE todoId = ?', [
        id,
      ]);
      expect(Number(assoc[0].c)).toBe(0);
      const inTrash = await trash().expect(200);
      expect(inTrash.body.todos.map((t: { id: string }) => t.id)).not.toContain(id);

      // Second permanent delete of the same id is a missing id → 404.
      await removePermanent(id).expect(404);
    });

    it('DELETE /api/todos/trash empties the trash and returns the count', async () => {
      const a = await create({ title: 'empty a' }).expect(201);
      const b = await create({ title: 'empty b' }).expect(201);
      await remove(a.body.id).expect(200);
      await remove(b.body.id).expect(200);

      const emptied = await emptyTrash().expect(200);
      expect(emptied.body.ok).toBe(true);
      expect(emptied.body.count).toBeGreaterThanOrEqual(2);

      const inTrash = await trash().expect(200);
      expect(inTrash.body.todos).toHaveLength(0);
    });
  });

  describe('importance (SPEC-todo-importance)', () => {
    const createListWith = (name: string, importantDefault: boolean | null, token = tokenA) =>
      auth(request(server()).post('/api/lists'), token).send({ name, importantDefault });
    const patchList = (id: string, body: Record<string, unknown>, token = tokenA) =>
      auth(request(server()).patch(`/api/lists/${id}`), token).send(body);

    it('round-trips an explicit override and defaults an omitted/null important to inherit', async () => {
      const explicit = await create({ title: 'explicit', important: true }).expect(201);
      expect(explicit.body.important).toBe(true);
      expect(explicit.body.effectiveImportant).toBe(true);

      const inherit = await create({ title: 'inherit', important: null }).expect(201);
      expect(inherit.body.important).toBeNull();
      expect(inherit.body.effectiveImportant).toBe(false);

      const omitted = await create({ title: 'omitted' }).expect(201);
      expect(omitted.body.important).toBeNull();
      expect(omitted.body.effectiveImportant).toBe(false);
    });

    it('inherits the list default and an explicit override wins', async () => {
      const l = await createListWith('Imp-default', true).expect(201);
      const inheriting = await create({ title: 'inheriting', listId: l.body.id }).expect(201);
      expect(inheriting.body.important).toBeNull();
      expect(inheriting.body.effectiveImportant).toBe(true);

      const overriding = await create({
        title: 'overriding',
        listId: l.body.id,
        important: false,
      }).expect(201);
      expect(overriding.body.effectiveImportant).toBe(false);
    });

    it('a list-default change reaches inheriting todos with no fan-out write and no version bump', async () => {
      const l = await createListWith('No-fanout', null).expect(201);
      const t = await create({ title: 'no-fanout', listId: l.body.id }).expect(201);
      expect(t.body.effectiveImportant).toBe(false);

      await patchList(l.body.id, { name: 'No-fanout', importantDefault: true }).expect(200);

      // The todo row itself is untouched (same version, same stored override) …
      const reread = await getOne(t.body.id).expect(200);
      expect(reread.body.version).toBe(0);
      expect(reread.body.important).toBeNull();
      // … yet the computed effective value picked up the new default.
      expect(reread.body.effectiveImportant).toBe(true);
    });

    it('clearing the override with PATCH null returns the todo to inheritance', async () => {
      const l = await createListWith('Clearing-imp', true).expect(201);
      const t = await create({ title: 'clear-imp', listId: l.body.id, important: false }).expect(
        201,
      );
      expect(t.body.effectiveImportant).toBe(false);

      const cleared = await patch(t.body.id, { important: null }).expect(200);
      expect(cleared.body.important).toBeNull();
      expect(cleared.body.effectiveImportant).toBe(true);
    });

    it('a todo with no list reports important ?? false', async () => {
      const t = await create({ title: 'no-list', listId: null, important: true }).expect(201);
      expect(t.body.effectiveImportant).toBe(true);

      const inheriting = await create({ title: 'no-list-inherit', listId: null }).expect(201);
      expect(inheriting.body.effectiveImportant).toBe(false);
    });

    it('filters on effectiveImportant in memory off the one cached todo:all entry', async () => {
      const l = await createListWith('Filter-imp', true).expect(201);
      const viaDefault = await create({ title: 'via-default', listId: l.body.id }).expect(201);
      const explicitFalse = await create({
        title: 'explicit-false',
        listId: l.body.id,
        important: false,
      }).expect(201);
      const explicitTrue = await create({ title: 'explicit-true', important: true }).expect(201);

      const imp = await list(`?listId=${l.body.id}&important=true`).expect(200);
      expect(imp.body.todos.map((x: { id: string }) => x.id)).toEqual([viaDefault.body.id]);

      const notImp = await list(`?listId=${l.body.id}&important=false`).expect(200);
      expect(notImp.body.todos.map((x: { id: string }) => x.id)).toEqual([explicitFalse.body.id]);

      expect((await getOne(explicitTrue.body.id).expect(200)).body.effectiveImportant).toBe(true);
    });
  });

  describe('TagRefs (association-only ids, no names)', () => {
    it('a tagIds write REPLACES the set, including dropping dangling ids', async () => {
      const created = await create({ title: 'refs', tagIds: [1, 2, 3] }).expect(201);
      expect(created.body.tagIds).toEqual([1, 2, 3]);

      const replaced = await patch(created.body.id, { tagIds: [9, 9, 10] }).expect(200);
      expect(replaced.body.tagIds).toEqual([9, 10]);

      const cleared = await patch(created.body.id, { tagIds: [] }).expect(200);
      expect(cleared.body.tagIds).toEqual([]);
    });

    it('omitting tagIds leaves the association set untouched', async () => {
      const created = await create({ title: 'keep-refs', tagIds: [5] }).expect(201);
      const updated = await patch(created.body.id, { title: 'keep-refs edited' }).expect(200);
      expect(updated.body.tagIds).toEqual([5]);
    });

    it('stores ids with no registry call and no names (dangling ids accepted)', async () => {
      const created = await create({ title: 'dangling', tagIds: [999999] }).expect(201);
      expect(created.body.tagIds).toEqual([999999]);

      const rows = await dataSource.query('SELECT tagId FROM todo_tag WHERE todoId = ?', [
        created.body.id,
      ]);
      expect(rows.map((r: { tagId: number }) => r.tagId)).toEqual([999999]);
    });
  });
});
