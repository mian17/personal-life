import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * Two-subject ownership isolation (Task 2, SPEC-note-ownership). Boots the real
 * app with the real guard and drives it over HTTP for two independently minted
 * subjects A and B: every query is scoped by the verified `sub`, and a foreign
 * id is indistinguishable from a missing one (byte-identical 404).
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

describe('Notes ownership (e2e)', () => {
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
    auth(request(app.getHttpServer()).post('/api/notes'), token).send(body);
  const list = (token: string) =>
    auth(request(app.getHttpServer()).get('/api/notes'), token);
  const trash = (token: string) =>
    auth(request(app.getHttpServer()).get('/api/notes/trash'), token);

  it('scopes list and trash to the caller (B sees nothing of A)', async () => {
    const active = await post({ body: 'a-active' }, tokenA).expect(201);
    const trashed = await post({ body: 'a-trashed' }, tokenA).expect(201);
    await auth(
      request(app.getHttpServer()).delete(`/api/notes/${trashed.body.id}`),
      tokenA,
    ).expect(200);

    // First case in the suite: B has created nothing, so B's world is empty.
    const bList = await list(tokenB).expect(200);
    expect(bList.body.notes).toEqual([]);
    const bTrash = await trash(tokenB).expect(200);
    expect(bTrash.body.notes).toEqual([]);

    const aList = await list(tokenA).expect(200);
    const aIds = aList.body.notes.map((n: { id: string }) => n.id);
    expect(aIds).toContain(active.body.id);
    expect(aIds).not.toContain(trashed.body.id);

    const aTrash = await trash(tokenA).expect(200);
    expect(aTrash.body.notes.map((n: { id: string }) => n.id)).toContain(trashed.body.id);
  });

  it('returns a byte-identical 404 for a foreign id and a missing id', async () => {
    const active = await post({ body: 'foreign-active' }, tokenA).expect(201);
    const trashed = await post({ body: 'foreign-trashed' }, tokenA).expect(201);
    await auth(
      request(app.getHttpServer()).delete(`/api/notes/${trashed.body.id}`),
      tokenA,
    ).expect(200);

    const compare404 = async (foreign: () => request.Test, missing: () => request.Test) => {
      const f = await foreign().expect(404);
      const m = await missing().expect(404);
      expect(f.status).toBe(m.status);
      expect(JSON.stringify(f.body)).toBe(JSON.stringify(m.body));
    };

    await compare404(
      () => auth(request(app.getHttpServer()).get(`/api/notes/${active.body.id}`), tokenB),
      () => auth(request(app.getHttpServer()).get(`/api/notes/${MISSING_ID}`), tokenB),
    );
    await compare404(
      () =>
        auth(request(app.getHttpServer()).patch(`/api/notes/${active.body.id}`), tokenB).send({
          body: 'hijack',
        }),
      () =>
        auth(request(app.getHttpServer()).patch(`/api/notes/${MISSING_ID}`), tokenB).send({
          body: 'hijack',
        }),
    );
    await compare404(
      () =>
        auth(request(app.getHttpServer()).delete(`/api/notes/${active.body.id}`), tokenB),
      () => auth(request(app.getHttpServer()).delete(`/api/notes/${MISSING_ID}`), tokenB),
    );
    await compare404(
      () =>
        auth(request(app.getHttpServer()).post(`/api/notes/${trashed.body.id}/restore`), tokenB),
      () => auth(request(app.getHttpServer()).post(`/api/notes/${MISSING_ID}/restore`), tokenB),
    );
    await compare404(
      () =>
        auth(
          request(app.getHttpServer()).delete(`/api/notes/${trashed.body.id}/permanent`),
          tokenB,
        ),
      () =>
        auth(request(app.getHttpServer()).delete(`/api/notes/${MISSING_ID}/permanent`), tokenB),
    );

    // B's failed attempts never touched A's rows.
    const reread = await auth(
      request(app.getHttpServer()).get(`/api/notes/${active.body.id}`),
      tokenA,
    ).expect(200);
    expect(reread.body.body).toBe('foreign-active');
    const aTrash = await trash(tokenA).expect(200);
    expect(aTrash.body.notes.map((n: { id: string }) => n.id)).toContain(trashed.body.id);
  });

  it("empties only the caller's trash", async () => {
    const a1 = await post({ body: 'empty-a1' }, tokenA).expect(201);
    const b1 = await post({ body: 'empty-b1' }, tokenB).expect(201);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${a1.body.id}`), tokenA).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${b1.body.id}`), tokenB).expect(200);

    const bEmptied = await auth(
      request(app.getHttpServer()).delete('/api/notes/trash'),
      tokenB,
    ).expect(200);
    expect(bEmptied.body.ok).toBe(true);
    expect(bEmptied.body.count).toBeGreaterThanOrEqual(1);

    // A's trashed note survives B's emptyTrash.
    const aTrashAfterB = await trash(tokenA).expect(200);
    expect(aTrashAfterB.body.notes.map((n: { id: string }) => n.id)).toContain(a1.body.id);
    const bTrashAfterB = await trash(tokenB).expect(200);
    expect(bTrashAfterB.body.notes).toEqual([]);

    // ...and the reverse: A's emptyTrash does not remove B's trash.
    const a2 = await post({ body: 'empty-a2' }, tokenA).expect(201);
    const b2 = await post({ body: 'empty-b2' }, tokenB).expect(201);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${a2.body.id}`), tokenA).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${b2.body.id}`), tokenB).expect(200);

    await auth(request(app.getHttpServer()).delete('/api/notes/trash'), tokenA).expect(200);

    const bTrashAfterA = await trash(tokenB).expect(200);
    expect(bTrashAfterA.body.notes.map((n: { id: string }) => n.id)).toContain(b2.body.id);
    const aTrashAfterA = await trash(tokenA).expect(200);
    expect(aTrashAfterA.body.notes).toEqual([]);
  });

  it("stamps the caller's sub on create (invisible to another subject)", async () => {
    const created = await post({ body: 'owned-by-a' }, tokenA).expect(201);

    const byA = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
      tokenA,
    ).expect(200);
    expect(byA.body.id).toBe(created.body.id);

    await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
      tokenB,
    ).expect(404);
  });

  it('stamps dev-user when NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    try {
      // No token: the dev bypass authenticates the request as `dev-user`.
      await request(app.getHttpServer()).post('/api/notes').send({ body: 'dev-owned' }).expect(201);
    } finally {
      process.env.NODE_ENV = BASE_NODE_ENV;
    }

    // Readable under `dev-user`'s verified token, invisible to user A.
    const devToken = await harness.sign({ subject: 'dev-user', expiresIn: 3600 });
    const devList = await list(devToken).expect(200);
    expect(devList.body.notes.map((n: { body: string }) => n.body)).toContain('dev-owned');

    const aList = await list(tokenA).expect(200);
    expect(aList.body.notes.map((n: { body: string }) => n.body)).not.toContain('dev-owned');
  });

  it('serializes no owner field in the NoteDto (list and get)', async () => {
    const noteKeys = ['body', 'createdAt', 'deletedAt', 'id', 'tags', 'updatedAt', 'version'].sort();
    const tagKeys = ['id', 'name'].sort();

    const created = await post({ body: 'shape-check', tags: ['shape'] }, tokenA).expect(201);
    const fetched = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
      tokenA,
    ).expect(200);

    expect(fetched.body).not.toHaveProperty('owner');
    expect(fetched.body).not.toHaveProperty('ownerSub');
    expect(Object.keys(fetched.body).sort()).toEqual(noteKeys);
    expect(Object.keys(fetched.body.tags[0]).sort()).toEqual(tagKeys);

    const listed = await list(tokenA).expect(200);
    const item = listed.body.notes.find((n: { id: string }) => n.id === created.body.id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('owner');
    expect(item).not.toHaveProperty('ownerSub');
    expect(Object.keys(item).sort()).toEqual(noteKeys);
  });

  it('preserves the full owner lifecycle (create/list/update/trash/restore)', async () => {
    const created = await post({ body: 'lifecycle', tags: ['life'] }, tokenA).expect(201);
    const id = created.body.id;
    expect(created.body.version).toBe(0);

    const listed = await list(tokenA).expect(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).toContain(id);

    const updated = await auth(
      request(app.getHttpServer()).patch(`/api/notes/${id}`),
      tokenA,
    )
      .send({ body: 'lifecycle edited', expectedVersion: 0 })
      .expect(200);
    expect(updated.body.body).toBe('lifecycle edited');
    expect(updated.body.version).toBe(1);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`), tokenA).expect(200);
    await auth(request(app.getHttpServer()).get(`/api/notes/${id}`), tokenA).expect(404);

    const trashed = await trash(tokenA).expect(200);
    expect(trashed.body.notes.map((n: { id: string }) => n.id)).toContain(id);

    const restored = await auth(
      request(app.getHttpServer()).post(`/api/notes/${id}/restore`),
      tokenA,
    ).expect(201);
    expect(restored.body.body).toBe('lifecycle edited');
    expect(restored.body.deletedAt).toBeNull();
    expect(restored.body.tags.map((t: { name: string }) => t.name)).toEqual(['life']);
  });
});
