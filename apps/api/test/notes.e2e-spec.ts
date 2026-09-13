import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';

const TEST_DB = join(__dirname, 'test-life.db');
process.env.DB_PATH = TEST_DB;
process.env.API_TOKEN = 'test-secret';

const auth = (r: request.Test) => r.set('Authorization', 'Bearer test-secret');

describe('Notes API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
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
});
