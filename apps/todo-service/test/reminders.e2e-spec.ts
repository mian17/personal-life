import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Todo } from '../src/todos/todo.entity';
import { TodosService } from '../src/todos/todos.service';
import { TODO_CACHE, TodosCache, type CacheHitOptions } from '../src/cache/todo-cache';
import { PushService } from '../src/push/push.service';
import {
  REMINDER_PUSH_SENDER,
  type PushSender,
  type ReminderPayload,
  VAPID_PRIVATE_KEY_ENV,
  VAPID_PUBLIC_KEY_ENV,
} from '../src/reminders/push-sender';
import { ReminderService } from '../src/reminders/reminder.service';

/**
 * `SPEC-todo-due-repeat-notify` Testing #6 + #8: the reminder sweep fires a due
 * row once, hands the fake sender the subscription's `endpoint`, clears
 * `reminderScheduledAt` through `markReminded` (bumping the owner generation),
 * deletes the exact subscription on 404/410, is a no-op without VAPID, and skips
 * done/trashed rows.
 *
 * The direct-DB deviation (Testing #8) is asserted here: a `sweep()` performs
 * **zero** read-through (`getThrough`) reads. The `TODO_CACHE` provider is
 * overridden with a recording `TodosCache`, and the DB is a throwaway sqlite file
 * in a private `mkdtemp` directory — never `apps/todo-service/data/**` (the hard line).
 */

const TEST_DIR = mkdtempSync(join(tmpdir(), 'todo-reminders-'));
const TEST_DB = join(TEST_DIR, 'test-reminders.db');
process.env.DB_PATH = TEST_DB;

const SUB = 'user-a';
const BASE_NODE_ENV = 'test';

/** A due row in the past: the 09:00 national reminder is long gone. */
const PAST_DUE = '2020-01-01';

class SpyingTodosCache extends TodosCache {
  readonly getThroughCalls: string[] = [];
  readonly bumps: string[] = [];

  override async getThrough<T>(
    sub: string,
    rest: string,
    loader: () => Promise<T>,
    options?: CacheHitOptions<T>,
  ): Promise<T> {
    this.getThroughCalls.push(rest);
    return super.getThrough(sub, rest, loader, options);
  }

  override async bumpGeneration(sub: string): Promise<void> {
    this.bumps.push(sub);
    return super.bumpGeneration(sub);
  }
}

interface SendCall {
  sub: string;
  endpoint: string;
  payload: ReminderPayload;
}

class FakePushSender implements PushSender {
  readonly calls: SendCall[] = [];
  readonly statuses = new Map<string, number>();

  async send(
    sub: string,
    endpoint: string,
    payload: ReminderPayload,
  ): Promise<{ endpoint: string; statusCode: number }> {
    this.calls.push({ sub, endpoint, payload });
    return { endpoint, statusCode: this.statuses.get(endpoint) ?? 201 };
  }
}

describe('Reminder sweep (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let todos: TodosService;
  let push: PushService;
  let reminder: ReminderService;
  let cache: SpyingTodosCache;
  let sender: FakePushSender;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;
    process.env[VAPID_PUBLIC_KEY_ENV] = 'test-public-key';
    process.env[VAPID_PRIVATE_KEY_ENV] = 'test-private-key';

    const { AppModule } = await import('../src/app.module');
    cache = new SpyingTodosCache(null);
    sender = new FakePushSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TODO_CACHE)
      .useValue(cache)
      .overrideProvider(REMINDER_PUSH_SENDER)
      .useValue(sender)
      .compile();
    await moduleRef.init();
    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get(DataSource);
    todos = moduleRef.get(TodosService, { strict: false });
    push = moduleRef.get(PushService, { strict: false });
    reminder = moduleRef.get(ReminderService, { strict: false });
  });

  afterEach(async () => {
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env[VAPID_PUBLIC_KEY_ENV] = 'test-public-key';
    process.env[VAPID_PRIVATE_KEY_ENV] = 'test-private-key';
    sender.calls.length = 0;
    sender.statuses.clear();
    cache.getThroughCalls.length = 0;
    cache.bumps.length = 0;
    await dataSource.query('DELETE FROM push_subscription');
    await dataSource.query('DELETE FROM todo');
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const subscribe = (endpoint: string, sub = SUB) =>
    push.subscribe(sub, { endpoint, keys: { p256dh: 'p', auth: 'a' } });

  const reminderOf = async (id: string): Promise<string | null> => {
    const rows = await dataSource.query(
      'SELECT reminderScheduledAt AS r FROM todo WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? (rows[0].r as string | null) : undefined!;
  };

  it('fires a due row once with the endpoint payload, clears it, and bumps generation', async () => {
    const endpoint = 'https://push.test/one';
    await subscribe(endpoint);
    const created = await todos.create(SUB, { title: 'Reminder title', dueDate: PAST_DUE });
    sender.calls.length = 0;
    cache.getThroughCalls.length = 0;
    cache.bumps.length = 0;

    const fired = await reminder.sweep();

    expect(fired).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      sub: SUB,
      endpoint,
      payload: { title: 'Reminder title', body: 'Todo reminder', url: `/todos/${created.id}/edit` },
    });
    expect(await reminderOf(created.id)).toBeNull();
    expect(cache.bumps).toContain(SUB);

    // One ping per occurrence: the cleared reminder never fires again.
    sender.calls.length = 0;
    expect(await reminder.sweep()).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('reads the DB directly: a sweep performs zero read-through cache reads', async () => {
    await subscribe('https://push.one');
    await subscribe('https://push.two');
    await todos.create(SUB, { title: 'no cache read', dueDate: PAST_DUE });
    cache.getThroughCalls.length = 0;

    await reminder.sweep();

    expect(cache.getThroughCalls).toHaveLength(0);
  });

  it('deletes exactly the endpoint the sender reports gone (410) and keeps the rest', async () => {
    const dead = 'https://push.test/dead';
    const alive = 'https://push.test/alive';
    await subscribe(dead);
    await subscribe(alive);
    sender.statuses.set(dead, 410);
    sender.statuses.set(alive, 201);
    await todos.create(SUB, { title: 'gone subscription', dueDate: PAST_DUE });

    await reminder.sweep();

    expect(sender.calls.map((c) => c.endpoint).sort((a: string, b: string) => a.localeCompare(b))).toEqual([alive, dead].sort((a: string, b: string) => a.localeCompare(b)));
    expect((await push.listFor(SUB)).map((s) => s.endpoint)).toEqual([alive]);
  });

  it('is a no-op when the VAPID keys are unset', async () => {
    delete process.env[VAPID_PUBLIC_KEY_ENV];
    delete process.env[VAPID_PRIVATE_KEY_ENV];
    await subscribe('https://push.test/no-vapid');
    const created = await todos.create(SUB, { title: 'no vapid', dueDate: PAST_DUE });
    sender.calls.length = 0;

    expect(await reminder.sweep()).toBe(0);
    expect(sender.calls).toHaveLength(0);
    // The reminder is untouched, so it fires once the keys return.
    expect(await reminderOf(created.id)).not.toBeNull();
  });

  it('skips done and trashed rows', async () => {
    await subscribe('https://push.test/skip');
    const done = await todos.create(SUB, { title: 'done row', dueDate: PAST_DUE });
    await todos.update(SUB, done.id, { done: true });
    const trashed = await todos.create(SUB, { title: 'trashed row', dueDate: PAST_DUE });
    await todos.remove(SUB, trashed.id);
    sender.calls.length = 0;

    expect(await reminder.sweep()).toBe(0);
    expect(sender.calls).toHaveLength(0);
    expect(await reminderOf(done.id)).not.toBeNull();

    const trashedRow = await dataSource.getRepository(Todo).findOne({
      where: { id: trashed.id },
      withDeleted: true,
    });
    expect(trashedRow!.deletedAt).not.toBeNull();
  });
});
