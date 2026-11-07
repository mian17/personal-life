import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENC_PREFIX } from '@life/crypto';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * `SPEC-tags-service` Behaviour/API — the ecosystem tag registry over HTTP.
 *
 * Boots the real Nest app (global `AuthGuard`, real IdP-JWKS verification, real
 * sqlite DB) and drives the five endpoints with two independently minted
 * subjects. Every fixture DB is a throwaway under `test/`; this suite NEVER
 * opens anything under `apps/tags-service/data/` (the hard line).
 *
 * The registry owns **vocabulary only** (MAP M1): no association tables exist,
 * so "delete-detach" is observed here as `resolve` omitting the id while the
 * other vocabulary rows stay untouched.
 */

const TEST_DB = join(__dirname, 'test-tags.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const MISSING_ID = 999999;

let tokenA = '';
let tokenB = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Tags API (e2e)', () => {
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
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
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

  const list = (token = tokenA) => auth(request(app.getHttpServer()).get('/api/tags'), token);
  const create = (name: string, token = tokenA) =>
    auth(request(app.getHttpServer()).post('/api/tags'), token).send({ name });
  const rename = (id: number, body: Record<string, unknown>, token = tokenA) =>
    auth(request(app.getHttpServer()).patch(`/api/tags/${id}`), token).send(body);
  const remove = (id: number, token = tokenA) =>
    auth(request(app.getHttpServer()).delete(`/api/tags/${id}`), token);
  const resolve = (ids: number[], token = tokenA) =>
    auth(request(app.getHttpServer()).post('/api/tags/resolve'), token).send({ ids });

  const rawNames = async (sub: string): Promise<string[]> => {
    const rows = await dataSource.query('SELECT name FROM tag WHERE ownerSub = ? ORDER BY id', [
      sub,
    ]);
    return rows.map((r: { name: string }) => r.name as string);
  };

  describe('auth', () => {
    it('rejects a missing token on the registry', async () => {
      await request(app.getHttpServer()).get('/api/tags').expect(401);
    });

    it('rejects a garbage bearer token', async () => {
      const res = await auth(request(app.getHttpServer()).get('/api/tags'), 'not-a-jwt').expect(
        401,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/tags', () => {
    it('returns owner-scoped tags name-sorted case-insensitively with version and createdAt', async () => {
      const b = await create('beta', tokenB).expect(201);
      const a1 = await create('zeta').expect(201);
      const a2 = await create('Alpha').expect(201);
      expect(b.body.id).toBeDefined();

      const res = await list().expect(200);
      // `{ tags, nextCursor }` — the bare array this route used to answer with is gone.
      expect(Object.keys(res.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
        'nextCursor',
        'tags',
      ]);
      expect(res.body.nextCursor).toBeNull();
      const tags = res.body.tags as Array<{ id: number; name: string; version: number; createdAt: string }>;
      expect(tags.map((t) => t.name)).toEqual(['Alpha', 'zeta']);
      for (const tag of tags) {
        expect(Object.keys(tag).sort((a: string, b: string) => a.localeCompare(b))).toEqual(['createdAt', 'id', 'name', 'version']);
        expect(typeof tag.version).toBe('number');
        expect(typeof tag.createdAt).toBe('string');
        expect(tag.createdAt.endsWith('Z')).toBe(true);
      }
      expect(tags.map((t) => t.id).sort((a: number, b: number) => a - b)).toEqual(
        [a1.body.id, a2.body.id].sort((a: number, b: number) => a - b),
      );

      // B's vocabulary never appears to A.
      const bList = await list(tokenB).expect(200);
      expect(bList.body.tags.map((t: { name: string }) => t.name)).toEqual(['beta']);
    });

    it('pages the case-insensitive name order with no gap and no duplicate', async () => {
      // A fresh owner so the walk sees only these rows. The names deliberately mix
      // cases and share no spelling, and two of them (`Zebra`/`apple`) straddle the
      // case fold — a predicate comparing raw names would order them the other way
      // and repeat or skip one at a page edge.
      const pageToken = await harness.sign({ subject: 'user-page', expiresIn: 3600 });
      for (const name of ['apple', 'Zebra', 'mango', 'Banana', 'cherry']) {
        await create(name, pageToken).expect(201);
      }

      const whole = await auth(
        request(app.getHttpServer()).get('/api/tags?limit=200'),
        pageToken,
      ).expect(200);
      const expected = (whole.body.tags as Array<{ name: string }>).map((t) => t.name);
      expect(expected).toEqual(['apple', 'Banana', 'cherry', 'mango', 'Zebra']);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = cursor === null ? { limit: '2' } : { limit: '2', cursor };
        const res = await auth(request(app.getHttpServer()).get('/api/tags').query(query), pageToken).expect(200);
        const page = res.body as { tags: Array<{ name: string }>; nextCursor: string | null };
        expect(Object.keys(res.body).sort((a: string, b: string) => a.localeCompare(b))).toEqual([
          'nextCursor',
          'tags',
        ]);
        expect(page.tags.length).toBeLessThanOrEqual(2);
        seen.push(...page.tags.map((t) => t.name));
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
  });

  describe('POST /api/tags (create-or-get, case-insensitive)', () => {
    it('collapses Work / work / WORK into one row (201 then 200, original spelling preserved)', async () => {
      const count = async (sub: string): Promise<number> => {
        const rows = await dataSource.query(
          'SELECT COUNT(*) AS c FROM tag WHERE ownerSub = ?',
          [sub],
        );
        return Number(rows[0].c);
      };
      const before = await count('user-a');

      const first = await create('Work').expect(201);
      expect(first.body).toMatchObject({ name: 'Work', version: 0 });

      const second = await create('work').expect(200);
      const third = await create('WORK').expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(third.body.id).toBe(first.body.id);
      expect(second.body.name).toBe('Work');
      expect(third.body.name).toBe('Work');

      // Exactly one new row despite three create calls.
      expect((await count('user-a')) - before).toBe(1);
    });

    it('stores names as enc.v1 envelopes with no plaintext in the raw column', async () => {
      const created = await create('TOPSECRET-NAME').expect(201);
      const raw = await rawNames('user-a');
      const stored = raw.find((n) => n.startsWith(ENC_PREFIX));
      expect(stored).toBeDefined();
      expect(stored).not.toContain('TOPSECRET-NAME');
      // The read path returns the original plaintext.
      const listed = await list().expect(200);
      expect(listed.body.tags.find((t: { id: number }) => t.id === created.body.id).name).toBe(
        'TOPSECRET-NAME',
      );
    });

    it('is per-owner: B may own the same name as A with a distinct id', async () => {
      const a = await create('Shared').expect(201);
      const b = await create('Shared', tokenB).expect(201);
      expect(b.body.id).not.toBe(a.body.id);
      expect(b.body.name).toBe('Shared');
    });

    it('rejects an empty name and a non-string name', async () => {
      const empty = await auth(request(app.getHttpServer()).post('/api/tags'), tokenA)
        .send({ name: '' })
        .expect(400);
      expect(empty.status).toBe(400);
      const nonString = await auth(request(app.getHttpServer()).post('/api/tags'), tokenA)
        .send({ name: 42 })
        .expect(400);
      expect(nonString.status).toBe(400);
      const missing = await auth(request(app.getHttpServer()).post('/api/tags'), tokenA)
        .send({})
        .expect(400);
      expect(missing.status).toBe(400);
    });
  });

  describe('PATCH /api/tags/:id (rename, single source of truth)', () => {
    it('renames once and every consumer path (list + resolve) sees the new name next call', async () => {
      const created = await create('Original').expect(201);

      const renamed = await rename(created.body.id, { name: 'Renamed' }).expect(200);
      expect(renamed.body).toMatchObject({ id: created.body.id, name: 'Renamed', version: 1 });

      // Single source: resolve returns the fresh name, not the old one.
      const resolved = await resolve([created.body.id]).expect(201);
      expect(resolved.body).toEqual([{ id: created.body.id, name: 'Renamed' }]);

      const listed = await list().expect(200);
      expect(listed.body.tags.find((t: { id: number }) => t.id === created.body.id).name).toBe(
        'Renamed',
      );
    });

    it('increments version on each rename and re-encrypts (fresh envelope)', async () => {
      const created = await create('Versioned').expect(201);
      const before = (await rawNames('user-a')).slice(-1)[0];

      const v1 = await rename(created.body.id, { name: 'Versioned v1' }).expect(200);
      expect(v1.body.version).toBe(1);
      const v2 = await rename(created.body.id, { name: 'Versioned v2' }).expect(200);
      expect(v2.body.version).toBe(2);

      const after = (await rawNames('user-a')).slice(-1)[0];
      expect(after.startsWith(ENC_PREFIX)).toBe(true);
      expect(after).not.toContain('Versioned v2');
      expect(after.split('.')[2]).not.toBe(before.split('.')[2]);
    });

    it('rejects a case-insensitive collision with a different tag (409) and leaves it unchanged', async () => {
      const alpha = await create('C-alpha').expect(201);
      const betaTag = await create('C-beta').expect(201);

      await rename(alpha.body.id, { name: 'C-BETA' }).expect(409);

      const listed = await list().expect(200);
      expect(listed.body.tags.find((t: { id: number }) => t.id === alpha.body.id).name).toBe('C-alpha');
      expect(listed.body.tags.find((t: { id: number }) => t.id === betaTag.body.id).name).toBe('C-beta');
    });

    it('allows a pure case change of the same tag (no self-collision)', async () => {
      const created = await create('CaseOnly').expect(201);
      const renamed = await rename(created.body.id, { name: 'CASEONLY' }).expect(200);
      expect(renamed.body).toMatchObject({ id: created.body.id, name: 'CASEONLY', version: 1 });
    });

    it('rejects a stale expectedVersion with 409 and leaves the row unchanged', async () => {
      const created = await create('Optimistic').expect(201);
      const first = await rename(created.body.id, { name: 'Optimistic 1', expectedVersion: 0 });
      expect(first.status).toBe(200);
      expect(first.body.version).toBe(1);

      await rename(created.body.id, { name: 'Optimistic stale', expectedVersion: 0 }).expect(409);

      const listed = await list().expect(200);
      const row = listed.body.tags.find((t: { id: number }) => t.id === created.body.id);
      expect(row.name).toBe('Optimistic 1');
      expect(row.version).toBe(1);
    });

    it('still renames without expectedVersion (legacy last-write-wins)', async () => {
      const created = await create('LWW').expect(201);
      await rename(created.body.id, { name: 'LWW one' }).expect(200);
      const second = await rename(created.body.id, { name: 'LWW two' }).expect(200);
      expect(second.body.name).toBe('LWW two');
      expect(second.body.version).toBe(2);
    });
  });

  describe('DELETE /api/tags/:id (detach, vocabulary only)', () => {
    it('removes the row; resolve omits the id afterwards and other rows are untouched', async () => {
      const keep = await create('Keep-me').expect(201);
      const drop = await create('Drop-me').expect(201);

      const removed = await remove(drop.body.id).expect(200);
      expect(removed.body).toMatchObject({ ok: true });

      const listed = await list().expect(200);
      expect(listed.body.tags.map((t: { id: number }) => t.id)).toContain(keep.body.id);
      expect(listed.body.tags.map((t: { id: number }) => t.id)).not.toContain(drop.body.id);

      // Consumers treat an omitted id as detached.
      const resolved = await resolve([keep.body.id, drop.body.id]).expect(201);
      expect(resolved.body).toEqual([{ id: keep.body.id, name: 'Keep-me' }]);

      // Second delete of the same id is a missing id → 404.
      await remove(drop.body.id).expect(404);
    });
  });

  describe('POST /api/tags/resolve', () => {
    it('returns [{id, name}] for the caller\'s own tags and omits unknown/foreign ids', async () => {
      const a = await create('R-a').expect(201);
      const b = await create('R-b', tokenB).expect(201);

      const resolved = await resolve([a.body.id, b.body.id, MISSING_ID]).expect(201);
      expect(resolved.body).toEqual([{ id: a.body.id, name: 'R-a' }]);
      expect(Object.keys(resolved.body[0]).sort((a: string, b: string) => a.localeCompare(b))).toEqual(['id', 'name']);

      // B sees only B's tag.
      const fromB = await resolve([a.body.id, b.body.id], tokenB).expect(201);
      expect(fromB.body).toEqual([{ id: b.body.id, name: 'R-b' }]);
    });

    it('rejects a non-array ids payload', async () => {
      const res = await auth(request(app.getHttpServer()).post('/api/tags/resolve'), tokenA)
        .send({ ids: 'nope' })
        .expect(400);
      expect(res.status).toBe(400);
    });
  });

  describe('ownership: foreign and missing ids are byte-identical 404, never 403', () => {
    it('PATCH/DELETE a foreign id matches a missing id exactly', async () => {
      const foreign = await create('Foreign-target').expect(201);

      const compare404 = async (target: number, token: string) => {
        const f = await rename(foreign.body.id, { name: 'hijack' }, token);
        const m = await rename(target, { name: 'hijack' }, token);
        expect(f.status).toBe(404);
        expect(m.status).toBe(404);
        expect(f.status).not.toBe(403);
        expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
        expect(f.body).not.toHaveProperty('ownerSub');
      };
      await compare404(MISSING_ID, tokenB);

      const delForeign = await remove(foreign.body.id, tokenB);
      const delMissing = await remove(MISSING_ID, tokenB);
      expect(delForeign.status).toBe(404);
      expect(delMissing.status).toBe(404);
      expect(JSON.stringify(delForeign.body)).toBe(JSON.stringify(delMissing.body));

      // A's row was never touched by B's failed attempts.
      const listed = await list().expect(200);
      expect(listed.body.tags.find((t: { id: number }) => t.id === foreign.body.id).name).toBe(
        'Foreign-target',
      );
    });
  });
});
