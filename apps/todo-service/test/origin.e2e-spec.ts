import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENC_PREFIX } from '@life/crypto';
import { OriginGrant } from '@life/service-kit';
import { dueSortKey } from '../src/todos/due-time.js';
import { nextOccurrence } from '../src/todos/recurrence.js';
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
/** Pinned so the occurrence guards' local-day arithmetic is deterministic. */
const TZ = 'Asia/Ho_Chi_Minh';
const PRODUCER_A = 'producer-a';
const PRODUCER_B = 'producer-b';
const GRANTED_ORIGIN = 'meal-service';
const APP_USER = 'user-a';
/** A second user who granted the same producer client, for a different origin. */
const OTHER_USER = 'user-b';
const OTHER_GRANTED_ORIGIN = 'calendar-service';

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
    process.env.TODO_TIMEZONE = TZ;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    tokenWithGrant = await harness.sign({ subject: APP_USER, clientId: PRODUCER_A });
    tokenWithoutGrant = await harness.sign({ subject: APP_USER, clientId: PRODUCER_B });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
    // A grant is per owner: two users may grant the same producer client, each with
    // its own origin. Client B is granted by nobody.
    await dataSource.getRepository(OriginGrant).insert([
      {
        ownerSub: APP_USER,
        clientId: PRODUCER_A,
        originService: GRANTED_ORIGIN,
        grantedAt: new Date(),
      },
      {
        ownerSub: OTHER_USER,
        clientId: PRODUCER_A,
        originService: OTHER_GRANTED_ORIGIN,
        grantedAt: new Date(),
      },
    ]);
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
  /** The service zone's calendar date today — the shape a date-only due is stored in. */
  const localToday = (): string => dueSortKey(new Date().toISOString(), TZ).slice(0, 10);

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

    it("stamps each owner's own granted origin for the same producer client", async () => {
      const ownerA = await createWithOrigin({ title: 'lunch for a', originId: 'meal-scoped' });
      const ownerB = await createWithOrigin(
        { title: 'meeting for b', originId: 'meal-scoped' },
        await harness.sign({ subject: OTHER_USER, clientId: PRODUCER_A }),
      );

      expect(ownerA.body.originService).toBe(GRANTED_ORIGIN);
      expect(ownerB.body.originService).toBe(OTHER_GRANTED_ORIGIN);

      const rows = await todosByOriginId('meal-scoped');
      expect(rows.map((row) => [row.ownerSub, row.originService]).sort()).toEqual([
        [APP_USER, GRANTED_ORIGIN],
        [OTHER_USER, OTHER_GRANTED_ORIGIN],
      ]);
    });

    it('rejects a client granted by other users but not by this one', async () => {
      // A third user presents producer A's client: two other users granted it, this
      // one never did, so the grant is invisible and the write is refused.
      const strangerToken = await harness.sign({ subject: 'user-c', clientId: PRODUCER_A });

      const response = await createWithOrigin(
        { title: 'sneak in', originId: 'ungranted-2' },
        strangerToken,
      );

      expect(response.status).toBe(403);
      expect(await todosByOriginId('ungranted-2')).toEqual([]);
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

    it('advances a repeating todo and stays open across two ticks', async () => {
      await createWithOrigin({
        title: 'protein target',
        originId: 'meal-repeat-1',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('meal-repeat-1');

      const first = await completeByOrigin('meal-repeat-1');
      const second = await completeByOrigin('meal-repeat-1');

      expect(first.status).toBe(201);
      expect(first.body.done).toBe(false);
      expect(first.body.dueDate).not.toBe('2020-01-01');
      expect(second.body.done).toBe(false);
      // The app's own tick moves the due strictly forward each time.
      expect(second.body.dueDate > first.body.dueDate).toBe(true);
      expect(await completionsOf(todo.id)).toHaveLength(2);
      const [row] = await todosByOriginId('meal-repeat-1');
      expect(row.done).toBe(false);
      expect(row.dueDate).toBe(second.body.dueDate);
    });

    it('writes no second completion row for an occurrence already logged', async () => {
      await createWithOrigin({
        title: 'repeat dup',
        originId: 'meal-repeat-dup',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('meal-repeat-dup');
      await completeByOrigin('meal-repeat-dup');
      // Restore the occurrence the first tick logged, so the next tick repeats it.
      await dataSource.getRepository(Todo).update(todo.id, { dueDate: '2020-01-01' });

      const second = await completeByOrigin('meal-repeat-dup');

      expect(second.status).toBe(201);
      expect(second.body.dueDate).toBe('2020-01-01');
      expect(await completionsOf(todo.id)).toHaveLength(1);
    });

    it('renames a repeating todo on the tick and leaves the logged history untouched', async () => {
      await createWithOrigin({
        title: 'target 2000',
        originId: 'meal-rename-1',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('meal-rename-1');
      const first = await completeByOrigin('meal-rename-1');
      const [logged] = await completionsOf(todo.id);
      await dataSource
        .getRepository(Todo)
        .update(todo.id, { updatedAt: new Date('2020-01-01T00:00:00.000Z') });

      const renamed = await completeByOrigin('meal-rename-1').send({ title: 'target 1800' });

      expect(renamed.status).toBe(201);
      expect(renamed.body.title).toBe('target 1800');
      expect(renamed.body.done).toBe(false);
      expect(renamed.body.dueDate > first.body.dueDate).toBe(true);

      const [row] = await todosByOriginId('meal-rename-1');
      // Stored as an envelope under the owner's key, never as plaintext.
      expect(row.title.startsWith(ENC_PREFIX)).toBe(true);
      expect(row.title).not.toContain('target 1800');
      expect(row.updatedAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00.000Z').getTime(),
      );
      // The rename touches the todo row only: earlier history is byte-identical.
      const history = await completionsOf(todo.id);
      expect(history).toHaveLength(2);
      expect(history.find((entry) => entry.id === logged.id)).toEqual(logged);
    });

    it('applies the title when the tick closes a non-repeating todo', async () => {
      await createWithOrigin({ title: 'stale target', originId: 'meal-rename-close' });

      const closed = await completeByOrigin('meal-rename-close').send({ title: 'fresh target' });

      expect(closed.status).toBe(201);
      expect(closed.body.done).toBe(true);
      expect(closed.body.title).toBe('fresh target');
    });

    it('keeps the stored title when the tick carries no body', async () => {
      await createWithOrigin({ title: 'no body title', originId: 'meal-nobody-1' });
      await createWithOrigin({ title: 'empty body title', originId: 'meal-nobody-2' });

      const bare = await completeByOrigin('meal-nobody-1');
      const empty = await completeByOrigin('meal-nobody-2').send({});

      expect(bare.status).toBe(201);
      expect(bare.body.title).toBe('no body title');
      expect(bare.body.done).toBe(true);
      expect(empty.status).toBe(201);
      expect(empty.body.title).toBe('empty body title');
      expect(empty.body.done).toBe(true);
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

  describe('complete by origin, occurrence-pinned', () => {
    const pinned = (originId: string, occurrence: string) =>
      completeByOrigin(originId).send({ occurrence });

    it('advances once across two ticks pinned to the same occurrence', async () => {
      await createWithOrigin({
        title: 'protein target',
        originId: 'pin-same-2',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('pin-same-2');

      const first = await pinned('pin-same-2', '2020-01-01');
      const second = await pinned('pin-same-2', '2020-01-01');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(first.body.done).toBe(false);
      const rows = await completionsOf(todo.id);
      expect(rows.map((entry) => entry.occurrence)).toEqual(['2020-01-01']);
      const [row] = await todosByOriginId('pin-same-2');
      expect(row.dueDate).toBe(first.body.dueDate);
    });

    it('logs one occurrence for four ticks pinned to the same occurrence', async () => {
      // The manual failure: four unpinned calls in one second ate four days.
      await createWithOrigin({
        title: 'protein target',
        originId: 'pin-same-4',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('pin-same-4');

      const responses = [
        await pinned('pin-same-4', '2020-01-01'),
        await pinned('pin-same-4', '2020-01-01'),
        await pinned('pin-same-4', '2020-01-01'),
        await pinned('pin-same-4', '2020-01-01'),
      ];

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
      const rows = await completionsOf(todo.id);
      expect(rows.map((entry) => entry.occurrence)).toEqual(['2020-01-01']);
      for (const response of responses) expect(response.body).toEqual(responses[0].body);
    });

    it('advances twice across two ticks pinned to different occurrences', async () => {
      await createWithOrigin({
        title: 'future repeat',
        originId: 'pin-two-1',
        dueDate: '2030-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('pin-two-1');

      const first = await pinned('pin-two-1', '2030-01-01');
      const second = await pinned('pin-two-1', '2030-01-02');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.dueDate).toBe('2030-01-02');
      expect(second.body.dueDate).toBe('2030-01-03');
      const rows = await completionsOf(todo.id);
      expect(rows.map((entry) => entry.occurrence).sort()).toEqual(['2030-01-01', '2030-01-02']);
    });

    it('refuses an occurrence in the future and writes nothing', async () => {
      await createWithOrigin({
        title: 'overdue target',
        originId: 'pin-future-1',
        dueDate: '2020-01-01',
        repeat: 'daily',
      });
      const [todo] = await todosByOriginId('pin-future-1');

      const response = await pinned('pin-future-1', nextOccurrence(localToday(), 'daily'));

      expect(response.status).toBe(400);
      expect(await completionsOf(todo.id)).toHaveLength(0);
      const [row] = await todosByOriginId('pin-future-1');
      expect(row.dueDate).toBe('2020-01-01');
    });

    it('closes a non-repeating todo once and no-ops a repeat pinned to that occurrence', async () => {
      await createWithOrigin({
        title: 'one-off target',
        originId: 'pin-close-1',
        dueDate: '2020-01-01',
      });
      const [todo] = await todosByOriginId('pin-close-1');

      const first = await pinned('pin-close-1', '2020-01-01');
      const second = await pinned('pin-close-1', '2020-01-01');

      expect(first.status).toBe(201);
      expect(first.body.done).toBe(true);
      expect(second.body).toEqual(first.body);
      const rows = await completionsOf(todo.id);
      expect(rows.map((entry) => entry.occurrence)).toEqual(['2020-01-01']);
    });
  });
});
