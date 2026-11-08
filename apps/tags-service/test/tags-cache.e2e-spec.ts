import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ENC_PREFIX } from '@life/crypto';
import { KeysService, UserKeys } from '@life/service-kit';
import { Tag } from '../src/tags/tag.entity';
import { TagsCache, createTagsCache, generationKey } from '../src/tags/tags-cache';
import { TagsService } from '../src/tags/tags.service';
import { FakeRedisClient, FailingRedisClient } from './fake-redis';

/**
 * `SPEC-tags-service` Cache Rules (AGENTS.md Contract 2): one cached shape —
 * the owner's serialized **ciphertext** tag rows — serves BOTH `GET /api/tags`
 * and `resolve`. Key `tags:<sub>:v<gen>:all` (no request parameters), one
 * per-owner generation counter, 60s TTL, fail-open, decrypt + sort after every
 * hit, and **no plaintext ever reaches Redis**.
 *
 * The cache is a real `@life/cache` instance over the recording fake client; the
 * DB is a real throwaway sqlite file so the loader genuinely reads ciphertext
 * rows. Never touches `apps/tags-service/data/**` (hard line).
 */

const MASTER_KEY = Buffer.alloc(32, 0x2b);
const SUB = 'user-a';

/** Records every raw value written, so no-plaintext assertions inspect the wire. */
class CapturingRedisClient extends FakeRedisClient {
  readonly values: Array<{ key: string; value: string }> = [];

  override async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<'OK'> {
    this.values.push({ key, value });
    return super.set(key, value, options);
  }
}

interface Harness {
  dataSource: DataSource;
  service: TagsService;
  dir: string;
}

async function makeHarness(cache: TagsCache): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'tags-cache-'));
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: join(dir, 'tags.db'),
    entities: [Tag, UserKeys],
    synchronize: true,
  });
  await dataSource.initialize();
  const keys = new KeysService(dataSource.getRepository(UserKeys), MASTER_KEY);
  const service = new TagsService(dataSource.getRepository(Tag), cache, keys);
  return { dataSource, service, dir };
}

describe('TagsCache (read-through + generation invalidation)', () => {
  let h: Harness;

  afterEach(async () => {
    if (h) {
      await h.dataSource.destroy();
      rmSync(h.dir, { recursive: true, force: true });
      h = undefined as unknown as Harness;
    }
  });

  /** The owner's current generation counter value (0 until the first write). */
  const currentGen = (client: FakeRedisClient, sub: string): number =>
    Number.parseInt(client.store.get(generationKey(sub)) ?? '0', 10) || 0;

  it('a second list is served from cache: one loader call, key tags:<sub>:v<gen>:all, 60s TTL', async () => {
    const client = new CapturingRedisClient();
    h = await makeHarness(new TagsCache(client));
    await h.service.create(SUB, 'Work');
    const queriesBefore = client.values.length;
    const gen = currentGen(client, SUB);

    const first = await h.service.list(SUB);
    const second = await h.service.list(SUB);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map((t) => t.name)).toEqual(['Work']);
    expect(client.sets).toHaveLength(1);
    expect(client.sets[0].key).toBe(`tags:${SUB}:v${gen}:all`);
    expect(client.sets[0].options).toEqual({ EX: 60 });
    expect(queriesBefore).toBe(0);
    // The stored value is ciphertext rows, not decrypted DTOs.
    expect(client.values[0].value).toContain(ENC_PREFIX);
    expect(client.values[0].value).not.toContain('Work');
  });

  it('list and resolve share the one cached row-set entry (slice by id after the hit)', async () => {
    const client = new CapturingRedisClient();
    h = await makeHarness(new TagsCache(client));
    const a = (await h.service.create(SUB, 'Alpha')).tag;
    const b = (await h.service.create(SUB, 'Beta')).tag;
    const gen = currentGen(client, SUB);

    await h.service.list(SUB);
    const resolved = await h.service.resolve(SUB, [b.id, a.id, 999999]);

    // resolve served from the list's single entry — no second loader populate.
    expect(client.sets).toHaveLength(1);
    expect(client.sets[0].key).toBe(`tags:${SUB}:v${gen}:all`);
    expect(resolved).toEqual([
      { id: b.id, name: 'Beta' },
      { id: a.id, name: 'Alpha' },
    ]);
  });

  it('every page of a paged listing is served from the one all entry', async () => {
    const client = new CapturingRedisClient();
    h = await makeHarness(new TagsCache(client));
    for (const name of ['apple', 'Banana', 'cherry']) await h.service.create(SUB, name);
    const gen = currentGen(client, SUB);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await h.service.page(SUB, { limit: 1, cursor });
      seen.push(...page.tags.map((tag) => tag.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(['apple', 'Banana', 'cherry']);
    // One populate for every page: `limit`/`cursor` are projections after the hit,
    // so neither can reach the key.
    expect(client.setCalls).toEqual([`tags:${SUB}:v${gen}:all`]);
  });

  it('no request parameter enters the key: list and resolve never add a second key', async () => {
    const client = new CapturingRedisClient();
    h = await makeHarness(new TagsCache(client));
    const t = (await h.service.create(SUB, 'One')).tag;
    const gen = currentGen(client, SUB);

    await h.service.list(SUB);
    await h.service.resolve(SUB, [t.id]);
    await h.service.resolve(SUB, []);

    expect(client.setCalls).toEqual([`tags:${SUB}:v${gen}:all`]);
  });

  it('every write (create/rename/delete) bumps the owner generation exactly once', async () => {
    const client = new FakeRedisClient();
    h = await makeHarness(new TagsCache(client));
    const created = (await h.service.create(SUB, 'Bumpable')).tag;
    expect(client.incrCalls).toEqual([generationKey(SUB)]);

    client.incrCalls.length = 0;
    const renamed = await h.service.rename(SUB, created.id, 'Bumpable 1');
    expect(client.incrCalls).toEqual([generationKey(SUB)]);

    client.incrCalls.length = 0;
    await h.service.remove(SUB, renamed.id);
    expect(client.incrCalls).toEqual([generationKey(SUB)]);
  });

  it('a create-or-get hit (existing name) does not bump; a fresh create does', async () => {
    const client = new FakeRedisClient();
    h = await makeHarness(new TagsCache(client));
    await h.service.create(SUB, 'Existing');
    client.incrCalls.length = 0;

    await h.service.create(SUB, 'existing'); // create-or-get → no write
    expect(client.incrCalls).toHaveLength(0);

    await h.service.create(SUB, 'brand-new');
    expect(client.incrCalls).toEqual([generationKey(SUB)]);
  });

  it('invalidation: after a write the stale entry is unreachable and a fresh read repopulates', async () => {
    const client = new FakeRedisClient();
    h = await makeHarness(new TagsCache(client));

    await h.service.list(SUB);
    expect(client.setCalls).toEqual([`tags:${SUB}:v0:all`]);

    await h.service.create(SUB, 'After');
    const after = await h.service.list(SUB);

    expect(client.setCalls).toContain(`tags:${SUB}:v1:all`);
    expect(after.map((t) => t.name)).toEqual(['After']);
  });

  it('a failed write (404 rename) never bumps', async () => {
    const client = new FakeRedisClient();
    h = await makeHarness(new TagsCache(client));

    await expect(h.service.rename(SUB, 424242, 'nope')).rejects.toThrow();
    expect(client.incrCalls).toHaveLength(0);
  });

  it('ciphertext-only: no known plaintext is serialized into any cached value', async () => {
    const TAG = 'TOPSECRET-TAG-NAME';
    const client = new CapturingRedisClient();
    h = await makeHarness(new TagsCache(client));
    const created = (await h.service.create(SUB, TAG)).tag;
    client.values.length = 0;

    await h.service.list(SUB);
    await h.service.resolve(SUB, [created.id]);

    expect(client.values).toHaveLength(1);
    for (const { value } of client.values) {
      expect(value).toContain(ENC_PREFIX);
      expect(value).not.toContain(TAG);
    }
  });

  it('raw DB column starts enc.v1. (store starts encrypted, no dual-read)', async () => {
    h = await makeHarness(new TagsCache(null));
    await h.service.create(SUB, 'AtRest');
    const rows = await h.dataSource.query('SELECT name FROM tag WHERE ownerSub = ?', [SUB]);
    expect(rows).toHaveLength(1);
    expect((rows[0].name as string).startsWith(ENC_PREFIX)).toBe(true);
    expect(rows[0].name).not.toContain('AtRest');
  });

  it('fail-open: Redis errors degrade to the DB path for reads and writes', async () => {
    h = await makeHarness(new TagsCache(new FailingRedisClient()));
    const created = (await h.service.create(SUB, 'Resilient')).tag;
    const listed = await h.service.list(SUB);
    expect(listed.map((t) => t.name)).toEqual(['Resilient']);
    expect(await h.service.resolve(SUB, [created.id])).toEqual([
      { id: created.id, name: 'Resilient' },
    ]);
  });

  it('selection: no REDIS_URL means the direct DB path (loader every call)', async () => {
    const cache = createTagsCache(undefined);
    const loader = jest.fn(async () => [{ id: 1, name: ENC_PREFIX + 'x.y' }]);
    await cache.getAllThrough(SUB, loader);
    await cache.getAllThrough(SUB, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('per-owner isolation: one owner\'s write never bumps another owner\'s counter', async () => {
    const client = new FakeRedisClient();
    h = await makeHarness(new TagsCache(client));
    const A = 'user-a';
    const B = 'user-b';

    await h.service.list(A);
    await h.service.list(B);
    expect(client.setCalls).toEqual([`tags:${A}:v0:all`, `tags:${B}:v0:all`]);

    await h.service.create(A, 'a-only');
    expect(client.incrCalls).toEqual([generationKey(A)]);
    expect(client.incrCalls).not.toContain(generationKey(B));

    // B's entry survives: B's next read is still a hit.
    await h.service.list(B);
    expect(client.setCalls.filter((k) => k.startsWith(`tags:${B}:`))).toHaveLength(1);
  });
});
