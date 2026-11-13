import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { DataSource } from 'typeorm';
import { Session } from '../src/sessions/session.entity.js';
import { SessionsService, type SessionRow } from '../src/sessions/sessions.service.js';
import { FocusCache } from '../src/cache/focus-cache.js';
import { HttpFocusTodos, type FocusTodos } from '../src/todos/focus-todos.client.js';
import { FakeRedisClient } from './fake-redis.js';
import { startThrowawayDatabase, type ThrowawayDatabase } from './setup-env.js';

/**
 * The task link on a recorded block (`SPEC-focus-service` §1): the id is stored, an id
 * the caller's read grant does not reach is refused rather than stored, and the
 * question the id raises is answered once — in a column, so a closed tab costs nothing.
 *
 * The grant check is the one thing here that cannot be faked away by a stub, so the
 * check is driven against a real local HTTP server standing in for todo-service's
 * `GET /api/todos/origin/open`. That is also how the assertions know the caller's own
 * bearer token was forwarded rather than a service credential invented.
 */

const OWNER = 'user-a';
const DAY = '2026-09-03';
const TASK = 'b7c1e4f0-0000-4000-8000-000000000001';
const OTHER_TASK = 'b7c1e4f0-0000-4000-8000-000000000002';

interface OpenCall {
  path: string | undefined;
  authorization: string | undefined;
}

describe('SessionsService — the task link', () => {
  let database: ThrowawayDatabase;
  let dataSource: DataSource;
  let redis: FakeRedisClient;
  let cache: FocusCache;
  let todoServer: Server;
  let todoCalls: OpenCall[] = [];
  let todoStatus = 200;
  let todoTasks: Array<{ id: string }> = [];

  /** A service over the real file, with the HTTP task client wired to the stand-in. */
  function serviceWith(todos?: FocusTodos): SessionsService {
    return new SessionsService(
      dataSource.getRepository(Session),
      cache,
      todos ?? new HttpFocusTodos(todoBaseUrl()),
    );
  }

  function todoBaseUrl(): string {
    return `http://127.0.0.1:${(todoServer.address() as { port: number }).port}`;
  }

  const storedTodoIds = async (): Promise<Array<{ todoId: string | null }>> =>
    dataSource.query('SELECT "todoId" FROM "focus_session" ORDER BY "createdAt" ASC, id ASC');

  beforeAll(async () => {
    database = await startThrowawayDatabase('sessions-todo');
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: database.path,
      entities: [Session],
      synchronize: true,
    });
    await dataSource.initialize();

    todoServer = createServer((req, res) => {
      todoCalls.push({ path: req.url, authorization: req.headers.authorization });
      res.statusCode = todoStatus;
      res.setHeader('content-type', 'application/json');
      res.end(todoStatus === 200 ? JSON.stringify(todoTasks) : '{}');
    });
    await new Promise<void>((resolve) => todoServer.listen(0, '127.0.0.1', resolve));
  });

  beforeEach(async () => {
    todoCalls = [];
    todoStatus = 200;
    todoTasks = [{ id: TASK }];
    redis = new FakeRedisClient();
    cache = new FocusCache(redis);
    await dataSource.query('DELETE FROM "focus_session"');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => todoServer.close(() => resolve()));
    await dataSource.destroy();
    await database.stop();
  });

  it('keeps a task id the caller’s grant reaches, and forwards the caller’s own token', async () => {
    const row = await serviceWith().create(
      OWNER,
      { date: DAY, minutes: 25, todoId: TASK },
      'Bearer owner',
    );

    expect(row.todoId).toBe(TASK);
    expect(await storedTodoIds()).toEqual([{ todoId: TASK }]);
    // The token is the caller's: a service credential would name the wrong grant.
    expect(todoCalls).toEqual([{ path: '/api/todos/origin/open', authorization: 'Bearer owner' }]);
  });

  it('records a block with no task without asking todo-service at all', async () => {
    const row = await serviceWith().create(OWNER, { date: DAY, minutes: 25 });

    expect(row.todoId).toBeNull();
    expect(todoCalls).toEqual([]);
  });

  it('refuses an id outside the caller’s read grant rather than storing it', async () => {
    todoTasks = [{ id: OTHER_TASK }];

    await expect(
      serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await storedTodoIds()).toEqual([]);
    // A refused write bumps nothing: the cache still speaks the pre-write generation.
    expect(redis.incrCalls).toEqual([]);
  });

  it('refuses an id when the caller has no read grant at all', async () => {
    todoStatus = 403;

    await expect(
      serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await storedTodoIds()).toEqual([]);
  });

  it('refuses an id it cannot verify, rather than storing an arbitrary string', async () => {
    todoStatus = 500;

    await expect(
      serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await storedTodoIds()).toEqual([]);
  });

  it('refuses an id when no todo-service is configured, and names the variable', async () => {
    const unconfigured = new HttpFocusTodos(undefined);

    await expect(
      serviceWith(unconfigured).create(OWNER, { date: DAY, minutes: 25, todoId: TASK }),
    ).rejects.toThrow('FOCUS_TODOS_API_URL');
    expect(await storedTodoIds()).toEqual([]);
  });

  it('round-trips the id through the served row', async () => {
    const created = await serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK });

    const page = await serviceWith().findAll(OWNER, { from: DAY, to: DAY });
    expect(page.sessions).toEqual([created]);
    expect(page.sessions[0]?.todoId).toBe(TASK);
  });

  it('bumps the owner generation once, after the insert, when the block names a task', async () => {
    const created = await serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK });

    expect(redis.incrCalls).toEqual(['focus:gen:user-a']);
    const page = await serviceWith().findAll(OWNER, { from: DAY, to: DAY });
    expect(page.sessions[0]).toEqual(created);
    expect(redis.setCalls).toEqual([`focus:${OWNER}:v1:sessions:${DAY}:${DAY}`]);
  });

  describe('the question the id raises', () => {
    it('starts unanswered, and answering it writes the answer down once', async () => {
      const created = await serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK });
      expect(created.todoAnsweredAt).toBeNull();

      const answered = await serviceWith().answer(OWNER, created.id);
      expect(answered.todoAnsweredAt).not.toBeNull();

      const again = await serviceWith().answer(OWNER, created.id);
      // A second answer keeps the first timestamp, so the question has one answer.
      expect(again.todoAnsweredAt).toBe(answered.todoAnsweredAt);
    });

    it('serves the answer, so the question survives the client that asked it', async () => {
      const created = await serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK });
      await serviceWith().answer(OWNER, created.id);

      // A fresh service and a fresh cache: what is left is the row on disk.
      redis = new FakeRedisClient();
      cache = new FocusCache(redis);
      const page = await serviceWith().findAll(OWNER, { from: DAY, to: DAY });

      expect(page.sessions[0]?.todoAnsweredAt).not.toBeNull();
    });

    it('never answers another owner’s block', async () => {
      const created = await serviceWith().create(OWNER, { date: DAY, minutes: 25, todoId: TASK });

      await expect(serviceWith().answer('user-b', created.id)).rejects.toThrow('no such session');
      const rows: SessionRow[] = (await serviceWith().findAll(OWNER, { from: DAY, to: DAY }))
        .sessions;
      expect(rows[0]?.todoAnsweredAt).toBeNull();
    });
  });
});

/**
 * The generated DDL, from a real `synchronize` boot of the same entity the service
 * runs — the only honest way to show what the column became on disk.
 */
describe('focus_session DDL as synchronize generated it', () => {
  it('holds todoId and the answer timestamp as nullable columns', async () => {
    const database = await startThrowawayDatabase('sessions-ddl');
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: database.path,
      entities: [Session],
      synchronize: true,
    });
    try {
      await dataSource.initialize();
      const [ddl] = (await dataSource.query(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'focus_session'`,
      )) as Array<{ sql: string }>;

      expect(ddl?.sql).toContain('"todoId" text');
      expect(ddl?.sql).toContain('"todoAnsweredAt" datetime');
      expect(ddl?.sql).not.toContain('REFERENCES');
      process.stdout.write(`\n${ddl?.sql}\n`);
    } finally {
      await dataSource.destroy();
      await database.stop();
    }
  });
});
