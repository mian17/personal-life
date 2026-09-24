import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

const TEST_DB = join(__dirname, 'test-life.db');
process.env.DB_PATH = TEST_DB;

// Every request now carries a minted JWT (Task 10); the guard is JWT-only.
// The token is minted once in beforeAll from an ephemeral local JWKS.
let token = '';
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

describe('Notes API (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;

  beforeAll(async () => {
    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
  });

  it('rejects missing token', async () => {
    await request(app.getHttpServer()).get('/api/notes').expect(401);
  });

  it('rejects a bad payload', async () => {
    await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: '' }),
    ).expect(400);
  });

  it('stores and returns timestamps as UTC', async () => {
    const before = Date.now();
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'utc check' }),
    ).expect(201);
    const after = Date.now();

    const iso = created.body.createdAt;
    expect(iso.endsWith('Z')).toBe(true);
    const ts = Date.parse(iso);
    expect(ts).toBeGreaterThanOrEqual(before - 2000);
    expect(ts).toBeLessThanOrEqual(after + 2000);

    const reread = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(reread.body.createdAt).toBe(iso);
  });

  it('hides tags that no longer have notes', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'x', tags: ['orphan'] }),
    ).expect(201);

    const withNote = await auth(request(app.getHttpServer()).get('/api/tags')).expect(200);
    expect(withNote.body.map((t: { name: string }) => t.name)).toContain('orphan');

    await auth(request(app.getHttpServer()).delete(`/api/notes/${created.body.id}`)).expect(200);

    const afterDelete = await auth(request(app.getHttpServer()).get('/api/tags')).expect(200);
    expect(afterDelete.body.map((t: { name: string }) => t.name)).not.toContain('orphan');
  });

  it('supports the full note lifecycle with tag filtering', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'hello', tags: ['Work'] }),
    ).expect(201);
    const id = created.body.id;
    expect(created.body.tags).toHaveLength(1);

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { body: string }) => n.body)).toContain('hello');

    const filtered = await auth(
      request(app.getHttpServer()).get('/api/notes?tag=work'),
    ).expect(200);
    expect(filtered.body.notes.map((n: { id: string }) => n.id)).toContain(id);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${id}`)
        .send({ body: 'hello edited', tags: ['idea'] }),
    ).expect(200);
    expect(updated.body.body).toBe('hello edited');
    expect(updated.body.tags.map((t: { name: string }) => t.name)).toEqual(['idea']);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    await auth(request(app.getHttpServer()).get(`/api/notes/${id}`)).expect(404);
  });

  it('creates notes with the documented initial version', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'versioned create' }),
    ).expect(201);
    expect(created.body.version).toBe(0);
  });

  it('returns version as a number on GET', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'versioned read' }),
    ).expect(201);

    const fetched = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(typeof fetched.body.version).toBe('number');
    expect(fetched.body.version).toBe(0);
  });

  it('increments version on a PATCH with the correct expectedVersion', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'optimistic ok' }),
    ).expect(201);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'optimistic edited', expectedVersion: 0 }),
    ).expect(200);
    expect(updated.body.version).toBe(1);
    expect(updated.body.body).toBe('optimistic edited');
  });

  it('rejects a stale expectedVersion with 409 and leaves the note unchanged', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'conflict base' }),
    ).expect(201);

    const first = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'conflict first', expectedVersion: 0 }),
    ).expect(200);
    expect(first.body.version).toBe(1);

    await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'conflict stale', expectedVersion: 0 }),
    ).expect(409);

    const reread = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(reread.body.body).toBe('conflict first');
    expect(reread.body.version).toBe(1);
  });

  it('still patches without expectedVersion (legacy last-write-wins)', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'legacy base' }),
    ).expect(201);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'legacy edited' }),
    ).expect(200);
    expect(updated.body.body).toBe('legacy edited');
    expect(updated.body.version).toBe(1);
  });

  it('moves a deleted note to trash and hides it from the main list', async () => {
    const created = await auth(
      request(app.getHttpServer())
        .post('/api/notes')
        .send({ body: 'trash me', tags: ['trashy'] }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).not.toContain(id);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    const trashed = trash.body.notes.find((n: { id: string }) => n.id === id);
    expect(trashed).toBeDefined();
    expect(trashed.deletedAt).not.toBeNull();
  });

  it('returns 404 for a trashed note on GET /:id and PATCH', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'hidden' }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    await auth(request(app.getHttpServer()).get(`/api/notes/${id}`)).expect(404);
    await auth(
      request(app.getHttpServer()).patch(`/api/notes/${id}`).send({ body: 'nope' }),
    ).expect(404);
  });

  it('restores a trashed note with the same createdAt, tags, and version', async () => {
    const created = await auth(
      request(app.getHttpServer())
        .post('/api/notes')
        .send({ body: 'restore me', tags: ['keep'] }),
    ).expect(201);
    const id = created.body.id;
    const createdAt = created.body.createdAt;

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${id}`)
        .send({ body: 'restore me edited' }),
    ).expect(200);
    expect(updated.body.version).toBe(1);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);

    const restored = await auth(
      request(app.getHttpServer()).post(`/api/notes/${id}/restore`),
    ).expect(201);
    expect(restored.body.createdAt).toBe(createdAt);
    expect(restored.body.tags.map((t: { name: string }) => t.name)).toEqual(['keep']);
    expect(restored.body.version).toBe(1);
    expect(restored.body.deletedAt).toBeNull();

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).toContain(id);
  });

  it('does not change version on trash or restore', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'version stable' }),
    ).expect(201);
    const id = created.body.id;
    expect(created.body.version).toBe(0);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    const trashed = trash.body.notes.find((n: { id: string }) => n.id === id);
    expect(trashed.version).toBe(0);

    const restored = await auth(
      request(app.getHttpServer()).post(`/api/notes/${id}/restore`),
    ).expect(201);
    expect(restored.body.version).toBe(0);
  });

  it('permanently deletes a note from trash and 404s on a second call', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'delete forever' }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}/permanent`)).expect(200);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    expect(trash.body.notes.map((n: { id: string }) => n.id)).not.toContain(id);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}/permanent`)).expect(404);
  });

  it('empties the trash and returns the deleted count', async () => {
    const a = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'empty a' }),
    ).expect(201);
    const b = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'empty b' }),
    ).expect(201);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${a.body.id}`)).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${b.body.id}`)).expect(200);

    const emptied = await auth(request(app.getHttpServer()).delete('/api/notes/trash')).expect(200);
    expect(emptied.body.ok).toBe(true);
    expect(emptied.body.count).toBeGreaterThanOrEqual(2);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    expect(trash.body.notes).toHaveLength(0);
  });
});
