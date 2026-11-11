import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OriginGrant } from '@life/service-kit';
import { Todo } from '../src/todos/todo.entity.js';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `SPEC-todo-origin` §8.3 — the two origin slices over HTTP.
 *
 * Boots the real Nest app (global `AuthGuard`, real IdP-JWKS verification, real
 * sqlite DB) so provenance comes from the verified token exactly as it does in
 * production. Producer client A holds a grant row, provisioned here out of band
 * because grants are never written by a request; client B deliberately holds
 * none. The fixture DB is a throwaway under `test/`.
 */

const TEST_DB = join(import.meta.dirname, 'test-origin.db');

const BASE_NODE_ENV = 'test';
const PRODUCER_A = 'producer-a';
const PRODUCER_B = 'producer-b';
const GRANTED_ORIGIN = 'meal-service';
const APP_USER = 'user-a';
const OTHER_USER = 'user-b';

let tokenWithGrant = '';
let tokenWithoutGrant = '';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Origin API (e2e)', () => {
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
    tokenWithoutGrant = await harness.sign({ subject: APP_USER, clientId: PRODUCER_B });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource
      .getRepository(OriginGrant)
      .insert({ clientId: PRODUCER_A, originService: GRANTED_ORIGIN, grantedAt: new Date() });
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
  const todosByOriginId = (originId: string) =>
    dataSource.getRepository(Todo).find({ where: { originId } });
  const completeByOrigin = (originId: string, token = tokenWithGrant) =>
    auth(request(server()).post(`/api/todos/origin/${originId}/complete`), token);
  const completionsOf = (todoId: string) =>
    dataSource.getRepository(TodoCompletion).find({ where: { todoId } });

  describe('create with origin', () => {
    it('stamps the granted origin and the supplied origin id on the row', async () => {
      const response = await createWithOrigin({ title: 'prep lunch', originId: 'meal-1' });

      expect(response.status).toBe(201);
      expect(response.body.originService).toBe(GRANTED_ORIGIN);
      expect(response.body.originId).toBe('meal-1');

      const [row] = await todosByOriginId('meal-1');
      expect(row.originService).toBe(GRANTED_ORIGIN);
      expect(row.originId).toBe('meal-1');
      expect(row.ownerSub).toBe(APP_USER);
    });

    it('rejects a client with no grant row and creates nothing', async () => {
      const response = await createWithOrigin(
        { title: 'sneak in', originId: 'ungranted-1' },
        tokenWithoutGrant,
      );

      expect(response.status).toBe(403);
      expect(await todosByOriginId('ungranted-1')).toEqual([]);
    });

    it('rejects a repeated origin id with a conflict and creates no second row', async () => {
      await createWithOrigin({ title: 'first', originId: 'meal-2' });

      const repeated = await createWithOrigin({ title: 'second', originId: 'meal-2' });

      expect(repeated.status).toBe(409);
      expect(await todosByOriginId('meal-2')).toHaveLength(1);
    });

    it('lets two owners hold the same origin id without colliding', async () => {
      const ownerA = await createWithOrigin({ title: 'lunch for a', originId: 'meal-shared' });
      const ownerB = await createWithOrigin(
        { title: 'lunch for b', originId: 'meal-shared' },
        await harness.sign({ subject: OTHER_USER, clientId: PRODUCER_A }),
      );

      expect(ownerA.status).toBe(201);
      expect(ownerB.status).toBe(201);
      expect(ownerA.body.id).not.toBe(ownerB.body.id);

      const rows = await todosByOriginId('meal-shared');
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.ownerSub).sort()).toEqual([APP_USER, OTHER_USER]);
    });
  });

  describe('complete by origin', () => {
    it('logs one completion across two calls and answers the same state both times', async () => {
      await createWithOrigin({ title: 'prep lunch', originId: 'meal-complete-1' });
      const [todo] = await todosByOriginId('meal-complete-1');

      const first = await completeByOrigin('meal-complete-1');
      const second = await completeByOrigin('meal-complete-1');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(first.body.done).toBe(true);
      expect(first.body.originId).toBe('meal-complete-1');
      expect(await completionsOf(todo.id)).toHaveLength(1);
    });

    it('answers 404 for an origin id another origin service created', async () => {
      await dataSource.getRepository(Todo).insert({
        id: 'foreign-origin-todo',
        title: 'enc.v1.foreign',
        note: null,
        done: false,
        important: null,
        dueDate: null,
        repeat: null,
        repeatDays: null,
        reminderScheduledAt: null,
        listId: null,
        origin: null,
        originService: 'calendar-service',
        originId: 'foreign-1',
        ownerSub: APP_USER,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const response = await completeByOrigin('foreign-1');

      expect(response.status).toBe(404);
      expect(await completionsOf('foreign-origin-todo')).toHaveLength(0);
    });

    it('rejects a client with no grant row and logs nothing', async () => {
      await createWithOrigin({ title: 'ungranted tick', originId: 'meal-complete-2' });
      const [todo] = await todosByOriginId('meal-complete-2');

      const response = await completeByOrigin('meal-complete-2', tokenWithoutGrant);

      expect(response.status).toBe(403);
      expect(await completionsOf(todo.id)).toHaveLength(0);
    });
  });
});
