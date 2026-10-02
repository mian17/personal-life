import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * `SPEC-todo-due-repeat-notify` Testing #7: the push-subscription HTTP surface.
 * Boots the real Nest app (guard + sqlite) and drives it over HTTP for two
 * subjects. `push_subscription` is deliberate capability storage, outside the
 * cache, so assertions read the table directly for row counts and key material.
 *
 * The fixture DB is a throwaway under `test/` — never `apps/todo-service/data/**`.
 */

const TEST_DB = join(__dirname, 'test-push.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const KEY_ENV = 'TODO_VAPID_PUBLIC_KEY';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const body = (endpoint: string, p256dh = 'p256dh-a', auth = 'auth-a') => ({
  endpoint,
  keys: { p256dh, auth },
});

describe('Push subscriptions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let tokenA = '';
  let tokenB = '';

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
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env[KEY_ENV] = originalEnv[KEY_ENV] ?? '';
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const server = () => app.getHttpServer();
  const getKey = (token = tokenA) => auth(request(server()).get('/api/push/key'), token);
  const subscribe = (b: object, token = tokenA) =>
    auth(request(server()).post('/api/push/subscribe'), token).send(b);
  const unsubscribe = (endpoint: string, token = tokenA) =>
    auth(request(server()).delete('/api/push/subscribe'), token).send({ endpoint });

  const count = async (sub: string, endpoint: string): Promise<number> => {
    const rows = await dataSource.query(
      'SELECT COUNT(*) AS c FROM push_subscription WHERE ownerSub = ? AND endpoint = ?',
      [sub, endpoint],
    );
    return Number(rows[0].c);
  };
  const keysFor = async (sub: string, endpoint: string): Promise<{ p256dh: string } | null> => {
    const rows = await dataSource.query(
      'SELECT p256dh FROM push_subscription WHERE ownerSub = ? AND endpoint = ?',
      [sub, endpoint],
    );
    return rows.length > 0 ? { p256dh: rows[0].p256dh as string } : null;
  };

  describe('GET /api/push/key', () => {
    it('returns the configured VAPID public key', async () => {
      process.env[KEY_ENV] = 'test-vapid-public-key';
      const res = await getKey().expect(200);
      expect(res.body).toEqual({ publicKey: 'test-vapid-public-key' });
    });

    it('rejects an unauthenticated caller', async () => {
      await request(server()).get('/api/push/key').expect(401);
    });
  });

  describe('POST /api/push/subscribe', () => {
    it('rejects a malformed or extra-key body with 400', async () => {
      await subscribe({ endpoint: 'https://push.test/1' }).expect(400);
      await subscribe({ keys: { p256dh: 'p', auth: 'a' } }).expect(400);
      await subscribe({ ...body('https://push.test/2'), extra: true }).expect(400);
      await subscribe({
        endpoint: 'https://push.test/3',
        keys: { p256dh: 'p', auth: 'a', extra: 'x' },
      }).expect(400);
    });

    it('upserts scoped by (sub, endpoint): a repeat subscribe refreshes, never duplicates', async () => {
      const endpoint = 'https://push.test/upsert';
      await subscribe(body(endpoint, 'p1', 'a1')).expect(201);
      await subscribe(body(endpoint, 'p2', 'a2')).expect(201);

      expect(await count('user-a', endpoint)).toBe(1);
      expect((await keysFor('user-a', endpoint))!.p256dh).toBe('p2');
    });

    it('does not let a second sub overwrite a row shared by endpoint', async () => {
      const endpoint = 'https://push.test/shared';
      await subscribe(body(endpoint, 'own-a', 'auth-a'), tokenA).expect(201);
      // Same endpoint, different owner: composite uniqueness gives B its own row.
      await subscribe(body(endpoint, 'own-b', 'auth-b'), tokenB).expect(201);

      expect(await count('user-a', endpoint)).toBe(1);
      expect(await count('user-b', endpoint)).toBe(1);
      // A's key material is untouched by B's write.
      expect((await keysFor('user-a', endpoint))!.p256dh).toBe('own-a');
      expect((await keysFor('user-b', endpoint))!.p256dh).toBe('own-b');
    });
  });

  describe('DELETE /api/push/subscribe', () => {
    it('is idempotent: an unknown endpoint still returns 200', async () => {
      await unsubscribe('https://push.test/never-subscribed').expect(200);
      await unsubscribe('https://push.test/never-subscribed').expect(200);
    });

    it("deletes only the caller's row and leaves a shared endpoint's other owner intact", async () => {
      const endpoint = 'https://push.test/delete-shared';
      await subscribe(body(endpoint, 'own-a', 'auth-a'), tokenA).expect(201);
      await subscribe(body(endpoint, 'own-b', 'auth-b'), tokenB).expect(201);

      await unsubscribe(endpoint, tokenA).expect(200);
      expect(await count('user-a', endpoint)).toBe(0);
      expect(await count('user-b', endpoint)).toBe(1);
    });
  });
});
