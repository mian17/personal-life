import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { dueSortKey, localToUtc, reminderLocal } from '../src/todos/due-time.js';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `SPEC-todo-custom-repeat` behavior at the service boundary: create/update
 * round-trip the plaintext `repeatDays` weekday set, the `custom ⟺ non-empty
 * days` invariant (and the repeat-requires-due rule still applying to custom),
 * the due-clear cascade, and the tick engine recording a completion for the
 * pre-advance due before advancing to the next chosen weekday. Boots the real
 * Nest app (guard + sqlite) exactly like `todos-due-repeat.e2e-spec.ts`.
 *
 * `TODO_TIMEZONE` is pinned to the national zone before `TodosService` is
 * constructed. The fixture DB is a throwaway under `test/`; this suite NEVER
 * opens `apps/todo-service/data/**` (the hard line).
 */

const TEST_DB = join(__dirname, 'test-todos-custom-repeat.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const TZ = 'Asia/Ho_Chi_Minh';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Todos custom repeat (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
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
    dataSource = app.get(DataSource);
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

  /** The service's own local-day key, day-granular. */
  const localToday = () => dueSortKey(new Date().toISOString(), TZ).slice(0, 10);
  const reminderAt = (due: string) =>
    localToUtc(reminderLocal(dueSortKey(due, TZ)), TZ).toISOString();

  /** ISO weekday (1=Mon … 7=Sun) of a `YYYY-MM-DD` string, computed in UTC. */
  const isoWeekdayOf = (localDate: string): number => {
    const [y, m, d] = localDate.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 ? 7 : wd;
  };

  const completions = (todoId: string) =>
    dataSource.getRepository(TodoCompletion).find({ where: { todoId } });

  describe('POST /api/todos', () => {
    it("round-trips repeat:'custom' + repeatDays:[4,5]", async () => {
      const created = await create({
        title: 'thu+fri',
        dueDate: '2026-10-05',
        repeat: 'custom',
        repeatDays: [4, 5],
      }).expect(201);

      expect(created.body.repeat).toBe('custom');
      expect(created.body.repeatDays).toEqual([4, 5]);

      const fetched = await getOne(created.body.id).expect(200);
      expect(fetched.body.repeat).toBe('custom');
      expect(fetched.body.repeatDays).toEqual([4, 5]);
    });

    it('normalizes repeatDays away for a non-custom repeat', async () => {
      const created = await create({
        title: 'canned with days',
        dueDate: '2026-10-05',
        repeat: 'daily',
        repeatDays: [4, 5],
      }).expect(201);

      expect(created.body.repeat).toBe('daily');
      expect(created.body.repeatDays).toBeNull();
    });

    it("rejects custom with no days (400 'custom repeat requires repeatDays')", async () => {
      const res = await create({
        title: 'custom no days',
        dueDate: '2026-10-05',
        repeat: 'custom',
      }).expect(400);
      expect(res.body.message).toBe('custom repeat requires repeatDays');
    });

    it('still requires a due date for custom (400)', async () => {
      const res = await create({
        title: 'custom no due',
        repeat: 'custom',
        repeatDays: [4],
      }).expect(400);
      expect(res.body.message).toBe('repeat requires a dueDate');
    });
  });

  describe('PATCH /api/todos/:id (repeatDays)', () => {
    it('sets days on an update and clears them by returning to a canned repeat', async () => {
      const created = await create({ title: 'set days', dueDate: '2026-10-05' }).expect(201);
      expect(created.body.repeatDays).toBeNull();

      const custom = await patch(created.body.id, { repeat: 'custom', repeatDays: [4] }).expect(
        200,
      );
      expect(custom.body.repeat).toBe('custom');
      expect(custom.body.repeatDays).toEqual([4]);

      // A days-only patch keeps the committed custom repeat.
      const more = await patch(created.body.id, { repeatDays: [5, 6] }).expect(200);
      expect(more.body.repeat).toBe('custom');
      expect(more.body.repeatDays).toEqual([5, 6]);

      // Switching to a canned repeat clears the set.
      const cleared = await patch(created.body.id, { repeat: 'daily' }).expect(200);
      expect(cleared.body.repeat).toBe('daily');
      expect(cleared.body.repeatDays).toBeNull();
    });

    it('clearing the due clears repeat and repeatDays together', async () => {
      const created = await create({
        title: 'clear custom due',
        dueDate: '2026-10-05',
        repeat: 'custom',
        repeatDays: [4, 5],
      }).expect(201);

      const cleared = await patch(created.body.id, { dueDate: null }).expect(200);
      expect(cleared.body.dueDate).toBeNull();
      expect(cleared.body.repeat).toBeNull();
      expect(cleared.body.repeatDays).toBeNull();
    });
  });

  describe('PATCH /api/todos/:id (advance-on-tick)', () => {
    it('records a completion for the pre-advance due, jumps to the next chosen day, keeps done false and re-arms the reminder', async () => {
      const created = await create({
        title: 'missed thu+fri',
        dueDate: '2026-01-01',
        repeat: 'custom',
        repeatDays: [4, 5],
      }).expect(201);

      const ticked = await patch(created.body.id, { done: true }).expect(200);

      expect(ticked.body.done).toBe(false);
      expect(ticked.body.version).toBe(1);
      const next = ticked.body.dueDate as string;
      expect(next >= localToday()).toBe(true);
      expect([4, 5]).toContain(isoWeekdayOf(next));
      expect(ticked.body.reminderScheduledAt).toBe(reminderAt(next));

      // Exactly one completion row, keyed by the PRE-advance due.
      const log = await completions(created.body.id);
      expect(log).toHaveLength(1);
      expect(log[0].occurrence).toBe('2026-01-01');
    });
  });
});
