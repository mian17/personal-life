import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';

const TEST_DB = join(__dirname, 'test-idp.db');
process.env.DB_PATH = TEST_DB;

describe('Health (e2e)', () => {
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

  it('reports healthy', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
