import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthGuard } from '@life/service-kit';
import type {
  List as ListDto,
  Todo as TodoDto,
  TodoCompletion as TodoCompletionDto,
} from '@life/shared';
import { TODO_CACHE, TodosCache } from '../src/cache/todo-cache';
import { TodoCompletion } from '../src/todos/todo-completion.entity';
import { VERIFIER_ENV } from '../src/service-config';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';
import { FakeRedisClient } from './fake-redis';

/**
 * The `todos` and `lists` batch routes (`SPEC-todo-service.md` §9). Every case
 * drives the real Nest app through supertest, so a route that resolved to the
 * wrong path fails here as a 404 rather than passing silently.
 *
 * The cache is a recording fake instead of the module's `REDIS_URL` selection:
 * "one bump per successful request, none after a rollback" is only observable if
 * the test can see the bumps.
 *
 * `NODE_ENV` is pinned to a non-development value for the whole suite: jest
 * workers share `process.env` and the guard's dev bypass reads it per request,
 * so in a development worker every subject would collapse to `dev-user`.
 *
 * The DB is a throwaway under `test/`; this suite NEVER opens anything under
 * `apps/todo-service/data/` (the hard line).
 */

const TEST_DB = join(__dirname, 'test-todos-batch.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const owner = 'batch-owner';
const stranger = 'batch-stranger';
/** An id no todo holds, for the cases where one item names an absent row. */
const MISSING_ID = '11111111-1111-4111-8111-111111111111';

describe('Todos and lists batch API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let redis: FakeRedisClient;
  let originalEnv: NodeJS.ProcessEnv;
  let token = '';
  let strangerToken = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ subject: owner, expiresIn: 3600 });
    strangerToken = await harness.sign({ subject: stranger, expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    redis = new FakeRedisClient();
    app = await startApp(new TodosCache(redis));
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  /** The app as `app.factory` builds it, with the cache swapped for the recorder. */
  async function startApp(cache: TodosCache): Promise<INestApplication> {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TODO_CACHE)
      .useValue(cache)
      .compile();
    const application = moduleRef.createNestApplication();
    application.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
    application.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await application.init();
    return application;
  }

  describe('POST /api/todos:batchCreate', () => {
    it('answers on the literal route with both rows in submission order', async () => {
      const titles = ['literal first', 'literal second'];

      const created = await batchCreateTodos(titles).expect(201);

      expect(created.body.map((todo: TodoDto) => todo.title)).toEqual(titles);
      expect(await listedTitles()).toEqual(expect.arrayContaining(titles));
    });

    it('does not answer on a slashed path, which would be the parameter route', async () => {
      await apiPost('/api/todos/batchCreate', { items: [{ title: 'nope' }] }).expect(404);
    });

    it('rejects eleven items with 400 and leaves the list untouched', async () => {
      const before = await listedTitles();
      const titles = batchTitles('over cap', 11);

      await batchCreateTodos(titles).expect(400);

      expect(await listedTitles()).toEqual(before);
    });

    it('rejects ten items when one has no title, writing none of them', async () => {
      const titles = batchTitles('rollback candidate', 9);
      const items = [...titles.map((title) => ({ title })), {}];

      await apiPost('/api/todos:batchCreate', { items }).expect(400);

      expect(await listedTitles()).not.toEqual(expect.arrayContaining(titles));
    });

    it('rejects one foreign listId with 404 and writes none of the ten', async () => {
      const foreignList = await createListAs(strangerToken, 'stranger list');
      const titles = batchTitles('foreign list batch', 9);

      await apiPost('/api/todos:batchCreate', {
        items: [...titles.map((title) => ({ title })), { title: 'foreign', listId: foreignList }],
      }).expect(404);

      expect(await listedTitles()).not.toEqual(expect.arrayContaining(titles));
    });
  });

  describe('POST /api/todos:batchUpdate', () => {
    it('rejects a stale expectedVersion on the seventh item with 409, leaving 1-6 unchanged', async () => {
      const todos = await createTenTodos('conflict base');
      const items = todos.map((todo, index) => ({
        id: todo.id,
        title: `conflict edited ${index}`,
        expectedVersion: index === 6 ? 5 : 0,
      }));

      await apiPost('/api/todos:batchUpdate', { items }).expect(409);

      const reread = [];
      for (const todo of todos) reread.push(await readTodo(todo.id));
      expect(reread.map((todo) => todo.title)).toEqual(
        todos.map((_todo, index) => `conflict base ${index}`),
      );
      expect(reread.map((todo) => todo.version)).toEqual(todos.map(() => 0));
    });

    it('writes the singular PATCH completion-log rows for a done tick', async () => {
      const [recurring, plain] = await createTenTodos('completion base');
      await apiPost('/api/todos:batchUpdate', {
        items: [
          { id: recurring.id, done: true },
          { id: plain.id, done: true },
        ],
      }).expect(200);

      const logged = await completionOccurrences([recurring.id, plain.id]);
      expect(logged.get(recurring.id)).toEqual(['~']);
      expect(logged.get(plain.id)).toEqual(['~']);
      expect(await trashedIds()).not.toEqual(expect.arrayContaining([recurring.id, plain.id]));
    });

    it('answers 404 for one missing id and changes no todo in the batch', async () => {
      const todos = await createTenTodos('missing base');
      const items = [
        ...todos.slice(0, 9).map((todo) => ({ id: todo.id, title: 'edited', expectedVersion: 0 })),
        { id: MISSING_ID, title: 'edited', expectedVersion: 0 },
      ];

      await apiPost('/api/todos:batchUpdate', { items }).expect(404);

      const reread = [];
      for (const todo of todos) reread.push(await readTodo(todo.id));
      expect(reread.map((todo) => todo.title)).toEqual(
        todos.map((_todo, index) => `missing base ${index}`),
      );
    });
  });

  describe('POST /api/todos:batchDelete', () => {
    it('answers 404 for one foreign id and leaves all ten live', async () => {
      const todos = await createTenTodos('foreign batch');
      const ids = todos.map((todo) => todo.id);
      const foreignId = await createTodoAs(strangerToken, 'stranger todo');

      await batchDeleteTodos([...ids.slice(1), foreignId]).expect(404);

      const live = await listedIds();
      expect(ids.every((id) => live.includes(id))).toBe(true);

      const trash = await trashedIds();
      expect(trash.filter((id) => ids.includes(id))).toEqual([]);
      expect(await listedIdsAs(strangerToken)).toContain(foreignId);
    });

    it('trashes a fully-owned batch, lists all ten in trash, and still restores', async () => {
      const todos = await createTenTodos('trash batch');
      const ids = todos.map((todo) => todo.id);

      const deleted = await batchDeleteTodos(ids).expect(200);

      expect(deleted.body.deleted).toEqual(ids);
      expect(await trashedIds()).toEqual(expect.arrayContaining(ids));
      expect(await listedIds()).not.toEqual(expect.arrayContaining(ids));

      const restored = await apiPost(`/api/todos/${ids[0]}/restore`, undefined).expect(201);
      expect(restored.body.deletedAt).toBeNull();
      expect(restored.body.version).toBe(0);
      expect(await listedIds()).toContain(ids[0]);
    });
  });

  describe('POST /api/lists:batchCreate and /api/lists:batchUpdate', () => {
    it('rejects two colliding names with 409 and creates neither list', async () => {
      await apiPost('/api/lists:batchCreate', {
        items: [{ name: 'Colliding' }, { name: 'colliding' }],
      }).expect(409);

      expect(await listedListNames()).not.toEqual(
        expect.arrayContaining(['Colliding', 'colliding']),
      );
    });

    it('renames three lists with one bump, and the new name reaches the completion log', async () => {
      const created = await apiPost('/api/lists:batchCreate', {
        items: [{ name: 'rename a' }, { name: 'rename b' }, { name: 'rename c' }],
      }).expect(201);
      const lists: ListDto[] = created.body;
      const bumpsBefore = redis.incrCalls.length;

      const renamed = await apiPost('/api/lists:batchUpdate', {
        items: lists.map((list, index) => ({ id: list.id, name: `renamed ${index}` })),
      }).expect(200);

      expect(renamed.body.map((list: ListDto) => list.name)).toEqual([
        'renamed 0',
        'renamed 1',
        'renamed 2',
      ]);
      expect(renamed.body.map((list: ListDto) => list.version)).toEqual([1, 1, 1]);
      expect(redis.incrCalls).toHaveLength(bumpsBefore + 1);
      expect(redis.incrCalls.at(-1)).toBe(`todo:gen:${owner}`);
      expect(await listedListNames()).toEqual(
        expect.arrayContaining(['renamed 0', 'renamed 1', 'renamed 2']),
      );

      // `TodoDto` carries no list name, so the observable `/api/todos` surface
      // for a rename is the completion log, which joins the name at read time.
      const listed = await apiPost('/api/todos', {
        title: 'todo in a renamed list',
        listId: lists[0].id,
      }).expect(201);
      await apiPatch(`/api/todos/${listed.body.id}`, { done: true }).expect(200);

      expect(await completedListName(listed.body.id)).toBe('renamed 0');
    });

    it('has no :batchDelete route for lists', async () => {
      await apiPost('/api/lists:batchDelete', { items: [{ id: MISSING_ID }] }).expect(404);
    });
  });

  describe('the singular routes and read surfaces', () => {
    it('still creates and patches a single todo', async () => {
      const created = await apiPost('/api/todos', { title: 'singular still works' }).expect(201);
      expect(created.body.version).toBe(0);

      const patched = await apiPatch(`/api/todos/${created.body.id}`, { title: 'patched' });
      expect(patched.body.version).toBe(1);
      expect(await listedIds()).toContain(created.body.id);
    });

    it('leaves GET /api/todos/tags, /trash and /completions answerable', async () => {
      await apiGet('/api/todos/tags').expect(200);
      await apiGet('/api/todos/trash').expect(200);
      await apiGet('/api/todos/completions').expect(200);
    });
  });

  describe('cache invalidation', () => {
    it('bumps once per successful batch request', async () => {
      const before = redis.incrCalls.length;

      await batchCreateTodos(['one bump a', 'one bump b']).expect(201);

      expect(redis.incrCalls).toHaveLength(before + 1);
    });

    it('bumps once for a list batch too, on the same owner counter', async () => {
      const before = redis.incrCalls.length;

      await apiPost('/api/lists:batchCreate', { items: [{ name: 'bump list' }] }).expect(201);

      expect(redis.incrCalls).toHaveLength(before + 1);
      expect(redis.incrCalls.at(-1)).toBe(`todo:gen:${owner}`);
    });

    it('bumps nothing when a batch rolls back', async () => {
      const before = redis.incrCalls.length;

      await batchCreateTodos(batchTitles('no bump', 11)).expect(400);
      await apiPost('/api/todos:batchUpdate', {
        items: [{ id: MISSING_ID, title: 'x', expectedVersion: 0 }],
      }).expect(404);
      await batchDeleteTodos([MISSING_ID]).expect(404);
      await apiPost('/api/lists:batchCreate', {
        items: [{ name: 'rollback' }, { name: 'rollback' }],
      }).expect(409);

      expect(redis.incrCalls).toHaveLength(before);
    });

    it('writes no cache entry of its own', async () => {
      const before = redis.sets.length;

      await batchCreateTodos(['cache entry a', 'cache entry b']).expect(201);

      expect(redis.sets).toHaveLength(before);
    });
  });

  function apiGet(path: string): request.Test {
    return authGet(token, path);
  }

  function authGet(bearer: string, path: string): request.Test {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${bearer}`);
  }

  function apiPost(path: string, body: unknown): request.Test {
    return apiPostAs(token, path, body);
  }

  function apiPostAs(bearer: string, path: string, body: unknown): request.Test {
    const call = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${bearer}`);
    return body === undefined ? call : call.send(body as object);
  }

  function apiPatch(path: string, body: unknown): request.Test {
    return request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  }

  async function createTodoAs(bearer: string, title: string): Promise<string> {
    const created = await apiPostAs(bearer, '/api/todos', { title }).expect(201);
    return created.body.id;
  }

  async function createListAs(bearer: string, name: string): Promise<string> {
    const created = await apiPostAs(bearer, '/api/lists', { name }).expect(201);
    return created.body.id;
  }

  function batchCreateTodos(titles: string[]): request.Test {
    return apiPost('/api/todos:batchCreate', { items: titles.map((title) => ({ title })) });
  }

  function batchDeleteTodos(ids: string[]): request.Test {
    return apiPost('/api/todos:batchDelete', { items: ids.map((id) => ({ id })) });
  }

  function batchTitles(label: string, count: number): string[] {
    return Array.from({ length: count }, (_unused, index) => `${label} ${index}`);
  }

  async function createTenTodos(label: string): Promise<TodoDto[]> {
    const created = await batchCreateTodos(batchTitles(label, 10)).expect(201);
    return created.body;
  }

  async function readTodo(id: string): Promise<TodoDto> {
    const todo = await apiGet(`/api/todos/${id}`).expect(200);
    return todo.body;
  }

  async function listedTitles(): Promise<string[]> {
    const listed = await apiGet('/api/todos?limit=200').expect(200);
    return listed.body.todos.map((todo: TodoDto) => todo.title);
  }

  async function listedIds(): Promise<string[]> {
    return listedIdsAs(token);
  }

  async function listedIdsAs(bearer: string): Promise<string[]> {
    const listed = await authGet(bearer, '/api/todos?limit=200').expect(200);
    return listed.body.todos.map((todo: TodoDto) => todo.id);
  }

  async function trashedIds(): Promise<string[]> {
    const trash = await apiGet('/api/todos/trash?limit=200').expect(200);
    return trash.body.todos.map((todo: TodoDto) => todo.id);
  }

  async function listedListNames(): Promise<string[]> {
    const listed = await apiGet('/api/lists').expect(200);
    return listed.body.map((list: ListDto) => list.name);
  }

  /** The list name `GET /api/todos/completions` joins for one todo's close. */
  async function completedListName(todoId: string): Promise<string | null> {
    const page = await apiGet('/api/todos/completions?limit=200').expect(200);
    const completion = page.body.completions.find(
      (row: TodoCompletionDto) => row.todoId === todoId,
    );
    return completion?.listName ?? null;
  }

  /**
   * The completion rows the singular `done: true` PATCH would have written, read
   * straight from the row these ids own — one `'~'` per non-recurring close.
   */
  async function completionOccurrences(todoIds: string[]): Promise<Map<string, string[]>> {
    const rows = await dataSource.getRepository(TodoCompletion).find();
    const occurrences = new Map<string, string[]>(
      todoIds.map((todoId) => [todoId, [] as string[]]),
    );
    for (const row of rows) {
      occurrences.get(row.todoId)?.push(row.occurrence);
    }
    return occurrences;
  }
});
