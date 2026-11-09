import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { ENC_PREFIX } from '@life/crypto';
import { DataSource } from 'typeorm';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `SPEC-todo-service` lists behaviour (Testing Strategy #5): create with a
 * case-insensitive collision → 409, rename collision → 409, stale
 * `expectedVersion` → 409, and delete-detach — a deleted list's todos survive
 * with `listId` cleared.
 *
 * Fixture DB is a throwaway under `test/`; this suite NEVER opens anything under
 * `apps/todo-service/data/` (the hard line).
 */

const TEST_DB = join(__dirname, 'test-lists.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Lists API (e2e)', () => {
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
  const listLists = (token = tokenA) => auth(request(server()).get('/api/lists'), token);
  const createList = (name: string, token = tokenA) =>
    auth(request(server()).post('/api/lists'), token).send({ name });
  const renameList = (id: string, body: Record<string, unknown>, token = tokenA) =>
    auth(request(server()).patch(`/api/lists/${id}`), token).send(body);
  const deleteList = (id: string, token = tokenA) =>
    auth(request(server()).delete(`/api/lists/${id}`), token);
  const createTodo = (body: Record<string, unknown>, token = tokenA) =>
    auth(request(server()).post('/api/todos'), token).send(body);
  const getTodo = (id: string, token = tokenA) =>
    auth(request(server()).get(`/api/todos/${id}`), token);

  const rawNames = async (sub: string): Promise<string[]> =>
    (
      await dataSource.query('SELECT name FROM list WHERE ownerSub = ? ORDER BY createdAt', [sub])
    ).map((r: { name: string }) => r.name as string);

  describe('GET /api/lists', () => {
    it('returns owner-scoped lists name-sorted case-insensitively, with version + createdAt', async () => {
      const b = await createList('beta', tokenB).expect(201);
      const z = await createList('zeta').expect(201);
      const a = await createList('Alpha').expect(201);
      expect(b.body.id).toBeDefined();

      const res = await listLists().expect(200);
      // `{ lists, nextCursor }` — the bare array this route used to answer with is gone.
      expect(Object.keys(res.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
        'lists',
        'nextCursor',
        'total',
      ]);
      expect(res.body.nextCursor).toBeNull();
      const lists = res.body.lists as Array<{
        id: string;
        name: string;
        version: number;
        createdAt: string;
      }>;
      expect(lists.map((l) => l.name)).toEqual(['Alpha', 'zeta']);
      for (const l of lists) {
        expect(Object.keys(l).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
          'createdAt',
          'id',
          'importantDefault',
          'name',
          'version',
        ]);
        expect(typeof l.version).toBe('number');
        expect(l.createdAt.endsWith('Z')).toBe(true);
      }
      expect(lists.map((l) => l.id).sort((a: string, b: string) => a.localeCompare(b))).toEqual(
        [a.body.id, z.body.id].sort((a: string, b: string) => a.localeCompare(b)),
      );

      // B's lists never appear to A.
      expect(
        (await listLists(tokenB).expect(200)).body.lists.map((l: { name: string }) => l.name),
      ).toEqual(['beta']);
    });

    it('pages the case-insensitive name order with no gap and no duplicate', async () => {
      // A fresh owner so the walk sees only these rows. `apple` and `Zebra`
      // straddle the case fold: a predicate comparing raw names would order them
      // the other way and repeat or skip one at a page edge.
      const pageToken = await harness.sign({ subject: 'user-page', expiresIn: 3600 });
      for (const name of ['apple', 'Zebra', 'mango', 'Banana', 'cherry']) {
        await createList(name, pageToken).expect(201);
      }

      const whole = await auth(request(server()).get('/api/lists?limit=200'), pageToken).expect(
        200,
      );
      const expected = (whole.body.lists as Array<{ name: string }>).map((l) => l.name);
      expect(expected).toEqual(['apple', 'Banana', 'cherry', 'mango', 'Zebra']);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = cursor === null ? { limit: '2' } : { limit: '2', cursor };
        const res = await auth(request(server()).get('/api/lists').query(query), pageToken).expect(
          200,
        );
        const page = res.body as { lists: Array<{ name: string }>; nextCursor: string | null };
        expect(Object.keys(res.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
          'lists',
          'nextCursor',
          'total',
        ]);
        expect(page.lists.length).toBeLessThanOrEqual(2);
        seen.push(...page.lists.map((l) => l.name));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 20);

      // The walk ended because the service said so, not because the guard tripped.
      expect(cursor).toBeNull();
      expect(pages).toBeGreaterThan(1);
      // No gap, no duplicate: the pages reassemble the one stable order exactly.
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    });

    it('narrows by a case-insensitive name substring and reports the narrowed total', async () => {
      const pageToken = await harness.sign({ subject: 'user-q', expiresIn: 3600 });
      for (const name of ['Work', 'workout', 'errand', 'home']) {
        await createList(name, pageToken).expect(201);
      }

      // limit=1 keeps the page shorter than the total on purpose: a `total` that
      // was really the page length would read 1 here.
      const res = await auth(
        request(server()).get('/api/lists').query({ q: 'WOR', limit: '1' }),
        pageToken,
      ).expect(200);
      expect(res.body.lists.map((l: { name: string }) => l.name)).toEqual(['Work']);
      expect(res.body.nextCursor).toEqual(expect.any(String));
      expect(res.body.total).toBe(2);

      const second = await auth(
        request(server())
          .get('/api/lists')
          .query({ q: 'WOR', limit: '1', cursor: res.body.nextCursor }),
        pageToken,
      ).expect(200);
      expect(second.body.lists.map((l: { name: string }) => l.name)).toEqual(['workout']);
      expect(second.body.nextCursor).toBeNull();
      expect(second.body.total).toBe(2);

      // A blank `q` is "no filter", not "match nothing".
      const blank = await auth(
        request(server()).get('/api/lists').query({ q: '   ', limit: '200' }),
        pageToken,
      ).expect(200);
      expect(blank.body.total).toBe(4);
    });

    it('walks past names holding the old cursor separator with no repeat and no 400', async () => {
      // The same defect as tags' walk, over the lists order: the cursor key is the
      // lower-cased name, and `|` is legal input. `a|b` split into an extra key
      // part (an endless repeat of one page) and `ends|` minted an empty one (a
      // 400 on a cursor the service itself issued). limit=1 puts the boundary on
      // each in turn.
      const pageToken = await harness.sign({ subject: 'user-pipe', expiresIn: 3600 });
      for (const name of ['a|b', 'ends|', 'plain', 'z|z']) {
        await createList(name, pageToken).expect(201);
      }

      const whole = await auth(request(server()).get('/api/lists?limit=200'), pageToken).expect(
        200,
      );
      const expected = (whole.body.lists as Array<{ name: string }>).map((l) => l.name);
      expect(expected).toEqual(['a|b', 'ends|', 'plain', 'z|z']);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = cursor === null ? { limit: '1' } : { limit: '1', cursor };
        const res = await auth(request(server()).get('/api/lists').query(query), pageToken).expect(
          200,
        );
        const page = res.body as { lists: Array<{ name: string }>; nextCursor: string | null };
        seen.push(...page.lists.map((l) => l.name));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 20);

      // Terminated because the service said so, having returned each row exactly once.
      expect(cursor).toBeNull();
      expect(pages).toBe(expected.length);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    });
  });

  describe('POST /api/lists', () => {
    it('stores names as enc.v1. envelopes with no plaintext in the raw column', async () => {
      const created = await createList('TOPSECRET-LIST').expect(201);
      const stored = (await rawNames('user-a')).find((n) => n.startsWith(ENC_PREFIX));
      expect(stored).toBeDefined();
      expect(stored).not.toContain('TOPSECRET-LIST');
      expect(
        (await listLists().expect(200)).body.lists.find(
          (l: { id: string }) => l.id === created.body.id,
        ).name,
      ).toBe('TOPSECRET-LIST');
    });

    it('rejects a case-insensitive collision within one owner with 409', async () => {
      await createList('Groceries').expect(201);
      const lower = await createList('groceries').expect(409);
      expect(lower.status).toBe(409);
      const upper = await createList('GROCERIES').expect(409);
      expect(upper.status).toBe(409);
    });

    it('allows the same name under a different owner', async () => {
      const a = await createList('Shared-List').expect(201);
      const b = await createList('Shared-List', tokenB).expect(201);
      expect(b.body.id).not.toBe(a.body.id);
    });

    it('rejects an empty name (400)', async () => {
      const empty = await createList('').expect(400);
      expect(empty.status).toBe(400);
      const missing = await auth(request(server()).post('/api/lists'), tokenA).send({}).expect(400);
      expect(missing.status).toBe(400);
    });
  });

  describe('PATCH /api/lists/:id', () => {
    it('renames and increments version', async () => {
      const created = await createList('Original').expect(201);
      const renamed = await renameList(created.body.id, { name: 'Renamed' }).expect(200);
      expect(renamed.body).toMatchObject({ id: created.body.id, name: 'Renamed', version: 1 });
    });

    it('rejects a case-insensitive collision with a different list (409) and leaves it unchanged', async () => {
      const alpha = await createList('C-alpha').expect(201);
      const beta = await createList('C-beta').expect(201);

      await renameList(alpha.body.id, { name: 'C-BETA' }).expect(409);

      const listed = await listLists().expect(200);
      expect(listed.body.lists.find((l: { id: string }) => l.id === alpha.body.id).name).toBe(
        'C-alpha',
      );
      expect(listed.body.lists.find((l: { id: string }) => l.id === beta.body.id).name).toBe(
        'C-beta',
      );
    });

    it('allows a pure case change of the same list', async () => {
      const created = await createList('CaseOnly').expect(201);
      const renamed = await renameList(created.body.id, { name: 'CASEONLY' }).expect(200);
      expect(renamed.body).toMatchObject({ id: created.body.id, name: 'CASEONLY', version: 1 });
    });

    it('rejects a stale expectedVersion with 409 and leaves the row unchanged', async () => {
      const created = await createList('Optimistic').expect(201);
      const first = await renameList(created.body.id, {
        name: 'Optimistic 1',
        expectedVersion: 0,
      }).expect(200);
      expect(first.body.version).toBe(1);

      await renameList(created.body.id, { name: 'Optimistic stale', expectedVersion: 0 }).expect(
        409,
      );

      const listed = await listLists().expect(200);
      const row = listed.body.lists.find((l: { id: string }) => l.id === created.body.id);
      expect(row).toMatchObject({ name: 'Optimistic 1', version: 1 });
    });

    it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
      const foreign = await createList('Foreign-target').expect(201);

      const f = await renameList(foreign.body.id, { name: 'hijack' }, tokenB).expect(404);
      const m = await renameList(MISSING_ID, { name: 'hijack' }, tokenB).expect(404);
      expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
      expect(f.body).not.toHaveProperty('ownerSub');
    });
  });

  describe('list importance default (SPEC-todo-importance)', () => {
    const createListWith = (name: string, importantDefault: boolean | null, token = tokenA) =>
      auth(request(server()).post('/api/lists'), token).send({ name, importantDefault });

    it('round-trips importantDefault and defaults omitted/null to null (= false)', async () => {
      const on = await createListWith('Imp-on', true).expect(201);
      expect(on.body.importantDefault).toBe(true);

      const off = await createListWith('Imp-off', false).expect(201);
      expect(off.body.importantDefault).toBe(false);

      const unset = await createListWith('Imp-unset', null).expect(201);
      expect(unset.body.importantDefault).toBeNull();

      const omitted = await createList('Imp-omitted').expect(201);
      expect(omitted.body.importantDefault).toBeNull();
    });

    it('PATCH sets and clears importantDefault without touching name-collision identity', async () => {
      const l = await createList('Imp-patch').expect(201);

      const set = await renameList(l.body.id, { name: 'Imp-patch', importantDefault: true }).expect(
        200,
      );
      expect(set.body.importantDefault).toBe(true);
      expect(set.body.version).toBe(1);

      const cleared = await renameList(l.body.id, {
        name: 'Imp-patch',
        importantDefault: null,
      }).expect(200);
      expect(cleared.body.importantDefault).toBeNull();

      // Omitted on a later PATCH leaves the stored default unchanged.
      const renamed = await renameList(l.body.id, { name: 'Imp-patch-2' }).expect(200);
      expect(renamed.body.importantDefault).toBeNull();
    });

    it('deleting a list detaches its todos: an inheriting todo falls back to false, an override survives', async () => {
      const l = await createListWith('Imp-detach', true).expect(201);
      const inheriting = await createTodo(
        { title: 'imp-inherit', listId: l.body.id },
        tokenA,
      ).expect(201);
      const overriding = await createTodo(
        { title: 'imp-override', listId: l.body.id, important: false },
        tokenA,
      ).expect(201);
      expect(inheriting.body.effectiveImportant).toBe(true);

      await deleteList(l.body.id).expect(200);

      const detached = await getTodo(inheriting.body.id).expect(200);
      expect(detached.body.listId).toBeNull();
      expect(detached.body.effectiveImportant).toBe(false);

      const kept = await getTodo(overriding.body.id).expect(200);
      expect(kept.body.listId).toBeNull();
      expect(kept.body.important).toBe(false);
      expect(kept.body.effectiveImportant).toBe(false);
    });
  });

  describe('DELETE /api/lists/:id — detach semantics', () => {
    it('deleting a list detaches its todos (they survive with listId cleared)', async () => {
      const l = await createList('Detach-me').expect(201);
      const t1 = await createTodo({ title: 'detach-1', listId: l.body.id }).expect(201);
      const t2 = await createTodo({ title: 'detach-2', listId: l.body.id }).expect(201);

      const removed = await deleteList(l.body.id).expect(200);
      expect(removed.body).toEqual({ ok: true });

      // Both todos survive, detached.
      const one = await getTodo(t1.body.id).expect(200);
      const two = await getTodo(t2.body.id).expect(200);
      expect(one.body).toMatchObject({ title: 'detach-1', listId: null });
      expect(two.body).toMatchObject({ title: 'detach-2', listId: null });

      // The list is gone, and a second delete is a missing id → 404.
      await deleteList(l.body.id).expect(404);
      expect(
        (await listLists().expect(200)).body.lists.map((l2: { id: string }) => l2.id),
      ).not.toContain(l.body.id);
    });

    it("only detaches the caller's todo (a foreign list delete is a 404, rows untouched)", async () => {
      const l = await createList('Owned-by-a').expect(201);
      const t = await createTodo({ title: 'still-attached', listId: l.body.id }, tokenA).expect(
        201,
      );

      await deleteList(l.body.id, tokenB).expect(404);

      const reread = await getTodo(t.body.id, tokenA).expect(200);
      expect(reread.body.listId).toBe(l.body.id);
    });
  });
});
