import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { dueSortKey, localToUtc } from '../src/todos/due-time.js';
import { nextOccurrence } from '../src/todos/recurrence.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `SPEC-todo-due-repeat-notify` Testing #2–#5: the timed/date-only due round-trip,
 * the repeat-requires-a-due 400, advance-on-tick, the reminder rule, and the
 * local-day `dueSortKey` order. Boots the real Nest app (guard + sqlite) exactly
 * like `todos.e2e-spec.ts`.
 *
 * `TODO_TIMEZONE` is pinned to the national zone before `TodosService` is
 * constructed, so every local ⇄ UTC expectation is deterministic. The fixture DB
 * is a throwaway under `test/` — this suite NEVER opens `apps/todo-service/data/**`
 * (the hard line).
 */

const TEST_DB = join(__dirname, 'test-todos-due-repeat.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const TZ = 'Asia/Ho_Chi_Minh';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Todos due/repeat (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let tokenA = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;
    process.env.TODO_TIMEZONE = TZ;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    tokenA = await harness.sign({ subject: 'user-a', expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
  });

  afterEach(() => {
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.TODO_TIMEZONE = TZ;
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  const server = () => app.getHttpServer();
  const create = (body: Record<string, unknown>) =>
    auth(request(server()).post('/api/todos'), tokenA).send(body);
  const getOne = (id: string) => auth(request(server()).get(`/api/todos/${id}`), tokenA);
  const patch = (id: string, body: Record<string, unknown>) =>
    auth(request(server()).patch(`/api/todos/${id}`), tokenA).send(body);
  const list = (query = '') => auth(request(server()).get(`/api/todos${query}`), tokenA);
  const createList = (name: string) =>
    auth(request(server()).post('/api/lists'), tokenA).send({ name });

  /** The service's own local-day key, day-granular. */
  const localToday = () => dueSortKey(new Date().toISOString(), TZ).slice(0, 10);

  const weekdayOf = (localDate: string): number => {
    const [y, m, d] = localDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  describe('POST /api/todos', () => {
    it('round-trips a timed due to a canonical UTC instant with repeat + reminder', async () => {
      const created = await create({
        title: 'timed weekly',
        dueDate: '2026-10-02T09:00',
        repeat: 'weekly',
      }).expect(201);

      const instant = localToUtc('2026-10-02T09:00', TZ).toISOString();
      expect(created.body.dueDate).toBe(instant);
      expect(created.body.repeat).toBe('weekly');
      expect(created.body.reminderScheduledAt).toBe(instant);

      const fetched = await getOne(created.body.id).expect(200);
      expect(fetched.body.dueDate).toBe(instant);
      expect(fetched.body.repeat).toBe('weekly');
      expect(fetched.body.reminderScheduledAt).toBe(instant);
    });

    it('keeps a date-only due verbatim and schedules a 09:00 national reminder', async () => {
      const created = await create({ title: 'date only', dueDate: '2026-10-02' }).expect(201);

      expect(created.body.dueDate).toBe('2026-10-02');
      expect(created.body.repeat).toBeNull();
      expect(created.body.reminderScheduledAt).toBe(
        localToUtc('2026-10-02T09:00', TZ).toISOString(),
      );
    });

    it('rejects repeat with no due (400) on create and on update', async () => {
      const created = await create({ title: 'no due repeat', repeat: 'daily' }).expect(400);
      expect(created.body.message).toBe('repeat requires a dueDate');

      const undated = await create({ title: 'undated' }).expect(201);
      const updated = await patch(undated.body.id, { repeat: 'daily' }).expect(400);
      expect(updated.body.message).toBe('repeat requires a dueDate');
    });
  });

  describe('PATCH /api/todos/:id (advance-on-tick)', () => {
    it('advances a missed daily todo to the next occurrence on/after now and keeps it open', async () => {
      const created = await create({
        title: 'missed daily',
        dueDate: '2020-01-01',
        repeat: 'daily',
      }).expect(201);

      const ticked = await patch(created.body.id, { done: true }).expect(200);

      expect(ticked.body.done).toBe(false);
      expect(ticked.body.version).toBe(1);
      expect(ticked.body.dueDate).not.toBe('2020-01-01');
      expect((ticked.body.dueDate as string) >= localToday()).toBe(true);
      expect(ticked.body.reminderScheduledAt).not.toBeNull();
    });

    it('advances a weekdays todo to a weekday on/after now (skips the weekend)', async () => {
      const created = await create({
        title: 'weekdays',
        dueDate: '2026-05-01',
        repeat: 'weekdays',
      }).expect(201);

      const ticked = await patch(created.body.id, { done: true }).expect(200);

      expect(ticked.body.done).toBe(false);
      const day = ticked.body.dueDate as string;
      expect(day >= localToday()).toBe(true);
      expect(weekdayOf(day)).toBeGreaterThanOrEqual(1);
      expect(weekdayOf(day)).toBeLessThanOrEqual(5);
    });

    it('advances a monthly todo on the 31st to a valid clamped day', async () => {
      const created = await create({
        title: 'monthly 31',
        dueDate: '2026-01-31',
        repeat: 'monthly',
      }).expect(201);

      const ticked = await patch(created.body.id, { done: true }).expect(200);

      expect(ticked.body.done).toBe(false);
      expect(ticked.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((ticked.body.dueDate as string) >= localToday()).toBe(true);
    });

    it('marks a non-recurring todo done', async () => {
      const created = await create({ title: 'one off' }).expect(201);
      const ticked = await patch(created.body.id, { done: true }).expect(200);
      expect(ticked.body.done).toBe(true);
    });
  });

  describe('reminder rule', () => {
    it('clearing the due clears the repeat and the reminder', async () => {
      const created = await create({
        title: 'clear due',
        dueDate: '2026-10-02',
        repeat: 'daily',
      }).expect(201);
      expect(created.body.reminderScheduledAt).not.toBeNull();

      const cleared = await patch(created.body.id, { dueDate: null }).expect(200);
      expect(cleared.body.dueDate).toBeNull();
      expect(cleared.body.repeat).toBeNull();
      expect(cleared.body.reminderScheduledAt).toBeNull();
    });
  });

  describe('ordering (dueSortKey local day)', () => {
    it('sorts a timed due by its local day, not the stored UTC day', async () => {
      const l = await createList('Local-day order').expect(201);
      // The date-only key is the shorter prefix of the timed value's local key,
      // so the date-only sorts first; the raw UTC instant (previous day) would
      // have sorted the timed todo first — the assertion pins the local semantics.
      const dated = await create({
        title: 'date-only oct 2',
        dueDate: '2026-10-02',
        listId: l.body.id,
      }).expect(201);
      const timed = await create({
        title: 'timed oct 2 02:00',
        dueDate: '2026-10-02T02:00',
        listId: l.body.id,
      }).expect(201);
      expect(timed.body.dueDate).toBe('2026-10-01T19:00:00.000Z');

      const res = await list(`?listId=${l.body.id}`).expect(200);
      expect(res.body.todos.map((t: { id: string }) => t.id)).toEqual([
        dated.body.id,
        timed.body.id,
      ]);
    });
  });

  describe('recurrence single-step contracts (service-facing)', () => {
    it('weekdays steps Fri → Mon', () => {
      expect(nextOccurrence('2026-05-01', 'weekdays')).toBe('2026-05-04');
    });

    it('monthly clamps the 31st to the target month length', () => {
      expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    });
  });
});
