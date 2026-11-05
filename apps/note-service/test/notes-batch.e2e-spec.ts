import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AuthGuard } from '@life/service-kit';
import { NOTES_CACHE, NotesCache } from '../src/notes/notes-cache';
import { VERIFIER_ENV } from '../src/service-config';
import type { Note as NoteDto } from '@life/shared';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';
import { FakeRedisClient } from './fake-redis';

/**
 * The `notes` batch trio (`SPEC-note-service.md` §9). Every case drives the real
 * Nest app through supertest, so a route that resolved to the wrong path fails
 * here as a 404 rather than passing silently.
 *
 * The cache is a recording fake instead of the module's `REDIS_URL` selection:
 * "one bump per successful request, none after a rollback" is only observable if
 * the test can see the bumps.
 *
 * `NODE_ENV` is pinned to a non-development value for the whole suite: jest
 * workers share `process.env` and the guard's dev bypass reads it per request,
 * so in a development worker every subject would collapse to `dev-user`.
 */

const TEST_DB = join(__dirname, 'test-life-batch.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const owner = 'batch-owner';
const stranger = 'batch-stranger';
/** An id no note holds, for the cases where the batch fails on a note that is absent. */
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Notes batch API (e2e)', () => {
  // A cold ts-jest compile of this spec plus `@life/service-kit` outruns Jest's
  // 5s default inside `beforeAll`, and the teardown that follows reads as a
  // native-binding failure when it is only a slow first compile.
  jest.setTimeout(30_000);

  let app: INestApplication;
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
    app = await startApp(new NotesCache(redis));
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  /** The app as `app.factory` builds it, with the cache swapped for the recorder. */
  async function startApp(cache: NotesCache): Promise<INestApplication> {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NOTES_CACHE)
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

  describe('POST /api/notes:batchCreate', () => {
    it('answers on the literal route with both rows in submission order', async () => {
      const bodies = ['literal first', 'literal second'];

      const created = await batchCreate(bodies).expect(201);

      expect(created.body.map((note: NoteDto) => note.body)).toEqual(bodies);
      expect(await listedBodies()).toEqual(expect.arrayContaining(bodies));
    });

    it('does not answer on a slashed path, which would be the parameter route', async () => {
      const response = await apiPost('/api/notes/batchCreate', { items: [{ body: 'nope' }] }).expect(
        404,
      );

      expect(response.body).toEqual(routedNowhere('POST', '/api/notes/batchCreate'));
    });

    it('rejects eleven items with 400 and leaves the list untouched', async () => {
      const before = await listedBodies();
      const bodies = batchBodies('over cap', 11);

      await batchCreate(bodies).expect(400);

      expect(await listedBodies()).toEqual(before);
    });

    it('rejects ten items when one has an empty body, writing none of them', async () => {
      const bodies = batchBodies('rollback candidate', 9);
      const items = [...bodies.map((body) => ({ body })), { body: '' }];

      await apiPost('/api/notes:batchCreate', { items }).expect(400);

      expect(await listedBodies()).not.toEqual(expect.arrayContaining(bodies));
    });

    it('leaves the trash untouched', async () => {
      const before = await trashedIds();

      await batchCreate(['not trash a', 'not trash b']).expect(201);

      expect(await trashedIds()).toEqual(before);
    });
  });

  describe('POST /api/notes:batchUpdate', () => {
    it('rejects a stale expectedVersion with 409 and changes no note in the batch', async () => {
      const [first, second, third] = await createThree('conflict base');

      await batchUpdate([
        { id: first.id, body: 'conflict edited first', expectedVersion: 0 },
        { id: second.id, body: 'conflict edited second', expectedVersion: 5 },
        { id: third.id, body: 'conflict edited third', expectedVersion: 0 },
      ]).expect(409);

      const reread = await Promise.all([first.id, second.id, third.id].map(readNote));
      expect(reread.map((note) => note.body)).toEqual([
        'conflict base 0',
        'conflict base 1',
        'conflict base 2',
      ]);
      expect(reread.map((note) => note.version)).toEqual([0, 0, 0]);
    });

    it('patches every item in one transaction when the versions match', async () => {
      const notes = await createThree('update base');

      const updated = await batchUpdate(
        notes.map((note, index) => ({
          id: note.id,
          body: `update edited ${index}`,
          expectedVersion: 0,
        })),
      ).expect(200);

      expect(updated.body.map((note: NoteDto) => note.body)).toEqual([
        'update edited 0',
        'update edited 1',
        'update edited 2',
      ]);
      expect(updated.body.map((note: NoteDto) => note.version)).toEqual([1, 1, 1]);
    });
  });

  describe('POST /api/notes:batchDelete', () => {
    it('answers 404 for one foreign id and leaves all ten live', async () => {
      const notes = await createTen('foreign batch');
      const ids = notes.map((note) => note.id);
      const foreignId = await createNoteAs(strangerToken, 'stranger note');

      await batchDelete([...ids.slice(1), foreignId]).expect(404);

      const live = await listedIds();
      expect(ids.every((id) => live.includes(id))).toBe(true);

      const trash = await trashedIds();
      expect(trash.filter((id) => ids.includes(id))).toEqual([]);
      expect(await listedIdsAs(strangerToken)).toContain(foreignId);
    });

    it('trashes a fully-owned batch, lists all ten in trash, and still restores', async () => {
      const notes = await createTen('trash batch');
      const ids = notes.map((note) => note.id);

      const deleted = await batchDelete(ids).expect(200);

      expect(deleted.body.deleted).toEqual(ids);
      expect(await trashedIds()).toEqual(expect.arrayContaining(ids));
      expect(await listedIds()).not.toEqual(expect.arrayContaining(ids));

      const restored = await apiPost(`/api/notes/${ids[0]}/restore`, undefined).expect(201);
      expect(restored.body.deletedAt).toBeNull();
      expect(restored.body.version).toBe(0);
      expect(await listedIds()).toContain(ids[0]);
    });
  });

  describe('the singular route', () => {
    it('still creates a single note', async () => {
      const created = await apiPost('/api/notes', { body: 'singular still works' }).expect(201);

      expect(created.body.body).toBe('singular still works');
      expect(created.body.version).toBe(0);
      expect(await listedIds()).toContain(created.body.id);
    });
  });

  describe('cache invalidation', () => {
    it('bumps once per successful batch request', async () => {
      const before = redis.incrCalls.length;

      await batchCreate(['one bump a', 'one bump b']).expect(201);

      expect(redis.incrCalls).toHaveLength(before + 1);
    });

    it('bumps nothing when a batch rolls back', async () => {
      const before = redis.incrCalls.length;

      await batchCreate(batchBodies('no bump', 11)).expect(400);
      await batchUpdate([{ id: MISSING_ID, body: 'x', expectedVersion: 0 }]).expect(404);
      await batchDelete([MISSING_ID]).expect(404);

      expect(redis.incrCalls).toHaveLength(before);
    });

    it('writes no cache entry of its own', async () => {
      const before = redis.sets.length;

      await batchCreate(['cache entry a', 'cache entry b']).expect(201);

      expect(redis.sets).toHaveLength(before);
    });
  });

  /**
   * What Nest answers for a request that matched no route at all. An absent path
   * answers exactly this body, so a 404 carrying a domain message (a batch route
   * that did resolve and then failed on its items) can never pass for an absent
   * route.
   */
  function routedNowhere(verb: string, path: string) {
    return { statusCode: 404, message: `Cannot ${verb} ${path}`, error: 'Not Found' };
  }

  function apiGet(path: string): request.Test {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  }

  function apiPost(path: string, body: unknown): request.Test {
    return apiPostAs(token, path, body);
  }

  function apiPostAs(bearer: string, path: string, body: unknown): request.Test {
    const call = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${bearer}`);
    return body === undefined ? call : call.send(body as object);
  }

  async function createNoteAs(bearer: string, body: string): Promise<string> {
    const created = await apiPostAs(bearer, '/api/notes', { body }).expect(201);
    return created.body.id;
  }

  function batchCreate(bodies: string[]): request.Test {
    return apiPost('/api/notes:batchCreate', { items: bodies.map((body) => ({ body })) });
  }

  function batchUpdate(items: Array<{ id: string; body: string; expectedVersion: number }>) {
    return apiPost('/api/notes:batchUpdate', { items });
  }

  function batchDelete(ids: string[]): request.Test {
    return apiPost('/api/notes:batchDelete', { items: ids.map((id) => ({ id })) });
  }

  function batchBodies(label: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => `${label} ${index}`);
  }

  async function createTen(label: string): Promise<NoteDto[]> {
    const created = await batchCreate(batchBodies(label, 10)).expect(201);
    return created.body;
  }

  async function createThree(label: string): Promise<NoteDto[]> {
    const created = await batchCreate(batchBodies(label, 3)).expect(201);
    return created.body;
  }

  async function readNote(id: string): Promise<NoteDto> {
    const note = await apiGet(`/api/notes/${id}`).expect(200);
    return note.body;
  }

  async function listedBodies(): Promise<string[]> {
    const listed = await apiGet('/api/notes?limit=200').expect(200);
    return listed.body.notes.map((note: NoteDto) => note.body);
  }

  async function listedIds(): Promise<string[]> {
    return listedIdsAs(token);
  }

  async function listedIdsAs(bearer: string): Promise<string[]> {
    const listed = await request(app.getHttpServer())
      .get('/api/notes?limit=200')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return listed.body.notes.map((note: NoteDto) => note.id);
  }

  async function trashedIds(): Promise<string[]> {
    const trash = await apiGet('/api/notes/trash?limit=200').expect(200);
    return trash.body.notes.map((note: NoteDto) => note.id);
  }
});
