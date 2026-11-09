import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AuthGuard } from '@life/service-kit';
import { TAGS_CACHE, TagsCache, generationKey } from '../src/tags/tags-cache.js';
import { VERIFIER_ENV } from '../src/service-config.js';
import type { TagDto } from '../src/tags/tags.service.js';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';
import { FakeRedisClient } from './fake-redis.js';

/**
 * The `tags` batch pair (`SPEC-tags-service.md` §9). Every case drives the real
 * Nest app through supertest, so a route that resolved to a parameterised or
 * slashed path fails here as a `404` rather than passing silently.
 *
 * The cache is a recording fake instead of the module's `REDIS_URL` selection:
 * "one bump when the batch actually wrote, none when it did not" is only
 * observable if the test can read the generation counter.
 */

const TEST_DB = join(__dirname, 'test-tags-batch.db');
process.env.DB_PATH = TEST_DB;

const owner = 'batch-tags-owner';
const stranger = 'batch-tags-stranger';
/** An id no tag holds, so a batch can fail on a tag that is absent. */
const MISSING_ID = 999999;

describe('Tags batch API (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;
  let redis: FakeRedisClient;
  let originalEnv: NodeJS.ProcessEnv;
  let token = '';
  let strangerToken = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.DB_PATH = TEST_DB;
    rmSync(TEST_DB, { force: true });

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ subject: owner, expiresIn: 3600 });
    strangerToken = await harness.sign({ subject: stranger, expiresIn: 3600 });

    redis = new FakeRedisClient();
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TAGS_CACHE)
      .useValue(new TagsCache(redis))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  describe('POST /api/tags:batchCreate', () => {
    it('answers on the literal route and both tags are listed afterwards', async () => {
      const names = ['batch literal first', 'batch literal second'];

      const created = await batchCreate(names).expect(201);

      expect(created.body.map((tag: TagDto) => tag.name)).toEqual(names);
      expect(await listedNames()).toEqual(expect.arrayContaining(names));
    });

    it('does not answer on a slashed path, which would be the parameter route', async () => {
      const response = await postAs(token, '/api/tags/batchCreate', {
        items: [{ name: 'nope' }],
      }).expect(404);

      expect(response.body).toEqual(routedNowhere('POST', '/api/tags/batchCreate'));
    });

    it('rejects eleven items with 400 and creates none of them', async () => {
      const before = await listedNames();
      const names = batchNames('over cap', 11);

      await batchCreate(names).expect(400);

      expect(await listedNames()).toEqual(before);
    });

    it('rejects ten items when one name is empty, creating none of them', async () => {
      const valid = batchNames('rollback candidate', 9);

      await post('/api/tags:batchCreate', {
        items: [...valid.map((name) => ({ name })), { name: '' }],
      }).expect(400);

      expect(await listedNames()).not.toEqual(expect.arrayContaining(valid));
    });

    it('reuses an existing name with its original spelling and leaves the generation alone', async () => {
      const existing = await createTag('Already Here');
      const generationBefore = currentGeneration();

      const created = await batchCreate(['already here', 'ALREADY HERE']).expect(201);

      expect(created.body.map((tag: TagDto) => tag.id)).toEqual([existing.id, existing.id]);
      expect(created.body.map((tag: TagDto) => tag.name)).toEqual(['Already Here', 'Already Here']);
      expect(currentGeneration()).toBe(generationBefore);
    });

    it('advances the generation by exactly one when the batch creates one new name', async () => {
      const generationBefore = currentGeneration();

      await batchCreate(['one new name', 'zz one new name neighbor']).expect(201);

      expect(currentGeneration()).toBe(generationBefore + 1);
    });
  });

  describe('POST /api/tags:batchUpdate', () => {
    it('renames all three tags of a fully-owned batch', async () => {
      const tags = await createThreeTags('rename base');

      const renamed = await batchUpdate(
        tags.map((tag, index) => ({
          id: tag.id,
          name: `rename edited ${index}`,
          expectedVersion: tag.version,
        })),
      ).expect(200);

      expect(renamed.body.map((tag: TagDto) => tag.name)).toEqual([
        'rename edited 0',
        'rename edited 1',
        'rename edited 2',
      ]);
      expect(await listedNames()).toEqual(expect.arrayContaining(['rename edited 0']));
    });

    it('answers 409 when one item renames onto a name another tag holds, renaming none', async () => {
      const [first, second, third] = await createThreeTags('collision base');
      const before = await listedNames();

      await batchUpdate([
        { id: first.id, name: 'collision edited first' },
        { id: second.id, name: third.name.toUpperCase() },
        { id: third.id, name: 'collision edited third' },
      ]).expect(409);

      expect(await listedNames()).toEqual(before);
    });

    it('answers 409 for a stale expectedVersion and changes no tag in the batch', async () => {
      const tags = await createThreeTags('stale base');
      const before = await listedNames();

      await batchUpdate([
        { id: tags[0].id, name: 'stale edited first', expectedVersion: 0 },
        { id: tags[1].id, name: 'stale edited second', expectedVersion: 5 },
        { id: tags[2].id, name: 'stale edited third', expectedVersion: 0 },
      ]).expect(409);

      expect(await listedNames()).toEqual(before);
    });

    it('answers 404 Tag not found for a foreign id and renames nothing', async () => {
      const tags = await createThreeTags('foreign base');
      const foreign = await createTagAs(strangerToken, 'stranger tag');
      const before = await listedNames();

      const response = await batchUpdate([
        { id: tags[0].id, name: 'foreign edited first' },
        { id: foreign.id, name: 'foreign edited second' },
      ]).expect(404);

      expect(response.body.message).toBe('Tag not found');
      expect(await listedNames()).toEqual(before);
      expect(await listedNamesAs(strangerToken)).toContain('stranger tag');
    });

    it('rejects a non-integer id with 400', async () => {
      const response = await post('/api/tags:batchUpdate', {
        items: [{ id: 'abc', name: 'text id' }],
      }).expect(400);

      // `BatchUpdateTagItem.id` is decorated `@IsInt`, so the batch rejects the id
      // through the DTO at the index it sits at, even though the route itself is a
      // POST with no `:id` parameter.
      expect(response.body.message).toEqual(['items.0.id must be an integer number']);
    });
  });

  describe('the routes the batch pair must not disturb', () => {
    it('leaves POST /api/tags/resolve answering with its own shape', async () => {
      const tag = await createTag('resolvable');

      const resolved = await post('/api/tags/resolve', { ids: [tag.id, MISSING_ID] }).expect(201);

      expect(resolved.body).toEqual([{ id: tag.id, name: 'resolvable' }]);
    });

    it('has no batchDelete route for tags', async () => {
      const response = await post('/api/tags:batchDelete', { items: [] }).expect(404);

      expect(response.body).toEqual(routedNowhere('POST', '/api/tags:batchDelete'));
    });

    it('still creates and renames a single tag', async () => {
      const created = await post('/api/tags', { name: 'singular batch neighbor' }).expect(201);

      const renamed = await request(app.getHttpServer())
        .patch(`/api/tags/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'singular renamed' })
        .expect(200);

      expect(renamed.body.name).toBe('singular renamed');
      expect(renamed.body.version).toBe(1);
    });

    it('does not bump the generation when the batch rolls back', async () => {
      const generationBefore = currentGeneration();

      await batchCreate(batchNames('no bump', 11)).expect(400);
      await batchUpdate([{ id: MISSING_ID, name: 'x' }]).expect(404);

      expect(currentGeneration()).toBe(generationBefore);
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

  function post(path: string, body: unknown): request.Test {
    return postAs(token, path, body);
  }

  function postAs(bearer: string, path: string, body: unknown): request.Test {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body as object);
  }

  function batchCreate(names: string[]): request.Test {
    return post('/api/tags:batchCreate', { items: names.map((name) => ({ name })) });
  }

  function batchUpdate(items: Array<{ id: number; name: string; expectedVersion?: number }>) {
    return post('/api/tags:batchUpdate', { items });
  }

  function batchNames(label: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => `${label} ${index}`);
  }

  async function createTag(name: string): Promise<TagDto> {
    return createTagAs(token, name);
  }

  async function createTagAs(bearer: string, name: string): Promise<TagDto> {
    const created = await postAs(bearer, '/api/tags', { name }).expect(201);
    return created.body;
  }

  async function createThreeTags(label: string): Promise<TagDto[]> {
    const created = await batchCreate(batchNames(label, 3)).expect(201);
    return created.body;
  }

  async function listedNames(): Promise<string[]> {
    return listedNamesAs(token);
  }

  async function listedNamesAs(bearer: string): Promise<string[]> {
    const listed = await request(app.getHttpServer())
      .get('/api/tags')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    // `GET /api/tags` answers `{ tags, nextCursor }`; the batch suite reads the page.
    return listed.body.tags.map((tag: TagDto) => tag.name);
  }

  /** The owner's generation counter — absent means untouched since the process began. */
  function currentGeneration(): number {
    return Number.parseInt(redis.store.get(generationKey(owner)) ?? '0', 10) || 0;
  }
});
