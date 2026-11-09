import { jest } from '@jest/globals';
import { rmSync } from 'fs';
import { ENC_PREFIX } from '@life/crypto';
import { encodeCursor } from '@life/service-kit';
import {
  TODO_ALL,
  TODO_LISTS,
  TODO_TAGS,
  TODO_TRASH,
  createTodosCache,
  generationKey,
  TodosCache,
} from '../src/cache/todo-cache.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';
import { FakeRedisClient, FailingRedisClient } from './fake-redis.js';

/**
 * `SPEC-todo-service` Cache Rules (AGENTS.md Contract 2):
 * - three cached shapes — the owner's serialized **ciphertext** todo rows
 *   (`todo:all`, each carrying its `tagIds`), list rows (`todo:lists`), and
 *   tag-usage metadata (`todo:tags`);
 * - keys `todo:<sub>:v<gen>:<rest>`; no request parameter (q, tagId, listId,
 *   done, due dates, cursor, limit) enters the key — one entry serves every
 *   variant;
 * - per-owner generation counter `todo:gen:<sub>` bumped per write, 60s TTL,
 *   fail-open, and **no content plaintext ever** reaches Redis (the plaintext
 *   `important`/`importantDefault` booleans are the documented non-content
 *   exception, mirroring `done` — `SPEC-todo-importance`).
 *
 * The cache is a real `@life/cache` instance over the recording fake client; the
 * DB is a real throwaway sqlite file so the loader genuinely reads ciphertext
 * rows. Never touches `apps/todo-service/data/**` (hard line).
 */

/** Records every raw value written, so no-plaintext assertions inspect the wire. */
class CapturingRedisClient extends FakeRedisClient {
  readonly values: Array<{ key: string; value: string }> = [];

  override async set(key: string, value: string, options?: { EX?: number }): Promise<'OK'> {
    this.values.push({ key, value });
    return super.set(key, value, options);
  }
}

describe('TodosCache (read-through + generation invalidation)', () => {
  let h: UnitHarness;

  afterEach(async () => {
    if (h) {
      await h.dataSource.destroy();
      rmSync(h.dir, { recursive: true, force: true });
      h = undefined as unknown as UnitHarness;
    }
  });

  const currentGen = (client: FakeRedisClient, sub: string): number =>
    Number.parseInt(client.store.get(generationKey(sub)) ?? '0', 10) || 0;

  /** Count the loader queries the driver emitted for one table. */
  const loaderCalls = (h2: UnitHarness, table: string): number =>
    h2.log.filter((sql) => new RegExp(`from "${table}"`, 'i').test(sql)).length;

  it('a second findAll is served from cache: one loader call, key todo:<sub>:v<gen>:all, 60s TTL', async () => {
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, { title: 'cached todo', note: 'body', tagIds: [4, 2] });
    h.log.length = 0;
    const gen = currentGen(client, SUB);

    const first = await h.todos.findAll(SUB, {});
    const second = await h.todos.findAll(SUB, {});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.todos[0].title).toBe('cached todo');
    expect(loaderCalls(h, 'todo')).toBe(1);
    expect(client.sets).toHaveLength(1);
    expect(client.sets[0].key).toBe(`todo:${SUB}:v${gen}:all`);
    expect(client.sets[0].options).toEqual({ EX: 60 });
    // The stored value is ciphertext rows carrying tagIds — not a decrypted DTO.
    expect(client.values[0].value).toContain(ENC_PREFIX);
    expect(client.values[0].value).not.toContain('cached todo');
    expect(client.values[0].value).toContain('"tagIds":[2,4]');
  });

  it('findTrash reads through the cache: two reads consult the repository once under todo:<sub>:v0:trash', async () => {
    const TITLE = 'TOPSECRET-TRASH-TITLE';
    const NOTE = 'TOPSECRET-TRASH-NOTE';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const t = await h.todos.create(SUB, { title: TITLE, note: NOTE, tagIds: [3] });
    await h.todos.remove(SUB, t.id);

    // The write path above only bumps the generation counter; dropping it pins
    // the trash key at `v0` for the assertion.
    client.store.delete(generationKey(SUB));
    h.log.length = 0;

    const first = await h.todos.findTrash(SUB, {});
    const second = await h.todos.findTrash(SUB, {});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.todos.map((row) => row.title)).toEqual([TITLE]);
    expect(loaderCalls(h, 'todo')).toBe(1);
    expect(client.sets).toHaveLength(1);
    expect(client.sets[0].key).toBe(`todo:${SUB}:v0:trash`);
    expect(client.sets[0].options).toEqual({ EX: 60 });
    // The stored value is ciphertext rows exactly as stored — never a decrypted DTO.
    expect(client.values[0].value).toContain(ENC_PREFIX);
    expect(client.values[0].value).not.toContain(TITLE);
    expect(client.values[0].value).not.toContain(NOTE);
    expect(client.values[0].value).toContain('"tagIds":[3]');
  });

  it('no request parameter enters the key: filters/pagination share the one `all` entry', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const l = await h.lists.create(SUB, 'Filter-list');
    const t = await h.todos.create(SUB, {
      title: 'alpha',
      note: 'beta',
      listId: l.id,
      tagIds: [1],
    });
    const gen = currentGen(client, SUB);
    h.log.length = 0;
    // `create` already populated `todo:lists` via the importance join; the
    // assertion is about the `all` entry, so reset the SET traffic first.
    client.sets.length = 0;

    await h.todos.findAll(SUB, {});
    await h.todos.findAll(SUB, { q: 'alpha' });
    await h.todos.findAll(SUB, { tagId: 1 });
    await h.todos.findAll(SUB, { listId: l.id });
    await h.todos.findAll(SUB, { done: false });
    await h.todos.findAll(SUB, { dueBefore: '2030-01-01', dueAfter: '2000-01-01' });
    // A cursor the seam itself issued: since the seam landed, a hand-made string is
    // a `400` by contract (`paging.ts` `decodeCursor`), so it is round-tripped first.
    await h.todos.findAll(SUB, {
      limit: 1,
      cursor: encodeCursor(['~', '2020-01-01T00:00:00.000Z', 'x']),
    });

    expect(loaderCalls(h, 'todo')).toBe(1);
    expect(client.setCalls).toEqual([`todo:${SUB}:v${gen}:all`]);
    void t;
  });

  it('applies the tag filter from the cached hit (each row carries its tagIds)', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, { title: 'tagged one', tagIds: [1] });
    await h.todos.create(SUB, { title: 'tagged two', tagIds: [2] });
    h.log.length = 0;

    const all = await h.todos.findAll(SUB, {});
    const byTag = await h.todos.findAll(SUB, { tagId: 2 });

    expect(all.todos).toHaveLength(2);
    expect(byTag.todos.map((t) => t.title)).toEqual(['tagged two']);
    // Both served from the single cached row-set.
    expect(loaderCalls(h, 'todo')).toBe(1);
  });

  it('list rows cache under todo:<sub>:v<gen>:lists as ciphertext', async () => {
    const LIST = 'TOPSECRET-LIST-NAME';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.lists.create(SUB, LIST);
    h.log.length = 0;
    const gen = currentGen(client, SUB);

    await h.lists.list(SUB);
    await h.lists.list(SUB);

    expect(loaderCalls(h, 'list')).toBe(1);
    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:lists`)!;
    expect(entry).toBeDefined();
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(LIST);
  });

  it('todo rows carry the plaintext importance boolean while title/note stay ciphertext-only', async () => {
    const TITLE = 'TOPSECRET-IMP-TODO-TITLE';
    const NOTE = 'TOPSECRET-IMP-TODO-NOTE';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, { title: TITLE, note: NOTE, important: true });
    client.values.length = 0;
    const gen = currentGen(client, SUB);

    await h.todos.findAll(SUB, {});

    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:all`)!;
    expect(entry).toBeDefined();
    // `important` is the documented non-content plaintext exception (mirrors `done`).
    expect(entry.value).toContain('"important":true');
    // Content columns are unchanged: `enc.v1.`-only, no plaintext leak.
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(TITLE);
    expect(entry.value).not.toContain(NOTE);
  });

  it('todo rows carry the plaintext repeat/reminderScheduledAt while content stays ciphertext-only', async () => {
    const TITLE = 'TOPSECRET-DUE-REPEAT-TITLE';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, { title: TITLE, dueDate: '2026-10-02', repeat: 'daily' });
    client.values.length = 0;
    const gen = currentGen(client, SUB);

    await h.todos.findAll(SUB, {});

    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:all`)!;
    expect(entry).toBeDefined();
    // The new non-content metadata rides the cached row verbatim (SPEC Cache Rules).
    expect(entry.value).toContain('"dueDate":"2026-10-02"');
    expect(entry.value).toContain('"repeat":"daily"');
    expect(entry.value).toContain('"reminderScheduledAt":"');
    // Content columns are unchanged: `enc.v1.`-only, no plaintext leak.
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(TITLE);
  });

  it('todo rows carry the custom repeatDays set while content stays ciphertext-only', async () => {
    const TITLE = 'TOPSECRET-CUSTOM-TITLE';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, {
      title: TITLE,
      dueDate: '2026-10-08',
      repeat: 'custom',
      repeatDays: [4, 5],
    });
    client.values.length = 0;
    const gen = currentGen(client, SUB);

    await h.todos.findAll(SUB, {});

    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:all`)!;
    expect(entry).toBeDefined();
    // The weekday set rides the cached row as non-content metadata (SPEC Cache Rules).
    expect(entry.value).toContain('"repeat":"custom"');
    expect(entry.value).toContain('"repeatDays":[4,5]');
    // Content columns are unchanged: `enc.v1.`-only, no plaintext leak.
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(TITLE);
  });

  it('trash rows also carry repeat/reminderScheduledAt as ciphertext rows', async () => {
    const TITLE = 'TOPSECRET-TRASH-REPEAT-TITLE';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const t = await h.todos.create(SUB, { title: TITLE, dueDate: '2026-10-02', repeat: 'weekly' });
    await h.todos.remove(SUB, t.id);
    // Drop the write bump so the trash key pins at v0 for the assertion.
    client.store.delete(generationKey(SUB));
    client.values.length = 0;

    await h.todos.findTrash(SUB, {});

    const entry = client.values.find((v) => v.key === `todo:${SUB}:v0:trash`)!;
    expect(entry).toBeDefined();
    expect(entry.value).toContain('"repeat":"weekly"');
    expect(entry.value).toContain('"reminderScheduledAt":"');
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(TITLE);
  });

  it('the sweep-clear seam markReminded bumps the owner generation after the write', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const created = await h.todos.create(SUB, { title: 'sweep-clear', dueDate: '2026-10-02' });
    expect(created.reminderScheduledAt).not.toBeNull();

    client.incrCalls.length = 0;
    await h.todos.markReminded(SUB, created.id);

    expect(client.incrCalls).toEqual([generationKey(SUB)]);
    const reread = await h.todos.findOne(SUB, created.id);
    expect(reread.reminderScheduledAt).toBeNull();
    // Clearing a fired reminder is not a domain write: version is untouched.
    expect(reread.version).toBe(0);
  });

  it('every page of a paged lists listing is served from the one todo:lists entry', async () => {
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    for (const name of ['apple', 'Banana', 'cherry']) await h.lists.create(SUB, name);
    const gen = currentGen(client, SUB);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await h.lists.page(SUB, { limit: 1, cursor });
      seen.push(...page.lists.map((list) => list.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(['apple', 'Banana', 'cherry']);
    // One populate for every page: `limit`/`cursor` are projections after the hit,
    // so neither can reach the key.
    expect(client.setCalls).toEqual([`todo:${SUB}:v${gen}:lists`]);
  });

  it('list rows carry the plaintext importantDefault boolean while name stays ciphertext-only', async () => {
    const LIST = 'TOPSECRET-IMP-LIST-NAME';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.lists.create(SUB, LIST, true);
    client.values.length = 0;
    const gen = currentGen(client, SUB);

    await h.lists.list(SUB);

    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:lists`)!;
    expect(entry).toBeDefined();
    expect(entry.value).toContain('"importantDefault":true');
    expect(entry.value).toContain(ENC_PREFIX);
    expect(entry.value).not.toContain(LIST);
  });

  it('fail-closed: the plaintext booleans leak no known content plaintext', async () => {
    const TITLE = 'TOPSECRET-IMP-CONTENT-TITLE';
    const NOTE = 'TOPSECRET-IMP-CONTENT-NOTE';
    const LIST = 'TOPSECRET-IMP-CONTENT-LIST';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const l = await h.lists.create(SUB, LIST, true);
    await h.todos.create(SUB, { title: TITLE, note: NOTE, listId: l.id, important: true });
    // Cold cache: `create` already populated `todo:lists` via the importance
    // join, so wipe the store to make both content shapes repopulate below.
    client.store.clear();
    client.values.length = 0;
    const gen = currentGen(client, SUB);

    await h.todos.findAll(SUB, {});
    await h.lists.list(SUB);

    const all = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:all`)!;
    const lists = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:lists`)!;
    expect(all).toBeDefined();
    expect(lists).toBeDefined();
    expect(all.value).toContain('"important":true');
    expect(lists.value).toContain('"importantDefault":true');
    for (const { value } of [all, lists]) {
      expect(value).toContain(ENC_PREFIX);
      expect(value).not.toContain(TITLE);
      expect(value).not.toContain(NOTE);
      expect(value).not.toContain(LIST);
    }
  });

  it('tag usage caches under todo:<sub>:v<gen>:tags as metadata-only (no ciphertext, no names)', async () => {
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    await h.todos.create(SUB, { title: 'usage-1', tagIds: [5] });
    await h.todos.create(SUB, { title: 'usage-2', tagIds: [5, 6] });
    h.log.length = 0;
    const gen = currentGen(client, SUB);

    const first = await h.todos.listTagUsage(SUB);
    const second = await h.todos.listTagUsage(SUB);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual([
      { tagId: 5, count: 2 },
      { tagId: 6, count: 1 },
    ]);
    expect(loaderCalls(h, 'todo_tag')).toBe(1);
    const entry = client.values.find((v) => v.key === `todo:${SUB}:v${gen}:tags`)!;
    expect(entry).toBeDefined();
    expect(entry.value).toContain('"tagId":5');
    expect(entry.value).toContain('"count":2');
    expect(entry.value).not.toContain(ENC_PREFIX);
    expect(entry.value).not.toContain('usage-1');
  });

  it('ciphertext-only: no known plaintext is serialized into any content value', async () => {
    const TITLE = 'TOPSECRET-TODO-TITLE';
    const NOTE = 'TOPSECRET-TODO-NOTE';
    const LIST = 'TOPSECRET-LIST';
    const client = new CapturingRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const l = await h.lists.create(SUB, LIST);
    const t = await h.todos.create(SUB, { title: TITLE, note: NOTE, listId: l.id, tagIds: [8] });
    // Cold cache: `create` populated `todo:lists` via the importance join, so
    // wipe the store to make every content shape repopulate below.
    client.store.clear();
    client.values.length = 0;

    await h.todos.findAll(SUB, {});
    await h.todos.findOne(SUB, t.id);
    await h.lists.list(SUB);
    await h.todos.listTagUsage(SUB);

    // Exactly the three spec shapes; after the cold-cache wipe `findOne` serves
    // from the `all` populate (no id-keyed shape exists) and `lists.list` from
    // the `lists` populate, so no fourth SET appears.
    const gen = currentGen(client, SUB);
    expect(client.values.map((v) => v.key)).toEqual([
      `todo:${SUB}:v${gen}:all`,
      `todo:${SUB}:v${gen}:lists`,
      `todo:${SUB}:v${gen}:tags`,
    ]);
    const contentValues = client.values.filter((v) => !v.key.endsWith(':tags'));
    expect(contentValues).toHaveLength(2);
    for (const { value } of contentValues) {
      expect(value).toContain(ENC_PREFIX);
      expect(value).not.toContain(TITLE);
      expect(value).not.toContain(NOTE);
      expect(value).not.toContain(LIST);
    }
    const tagsValue = client.values.find((v) => v.key.endsWith(':tags'))!;
    expect(tagsValue.value).not.toContain(ENC_PREFIX);
    expect(tagsValue.value).not.toContain(TITLE);
    expect(tagsValue.value).not.toContain(LIST);
  });

  it('findOne serves from the one `all` entry (no id ever enters the key space)', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const t = await h.todos.create(SUB, { title: 'one', tagIds: [1] });
    h.log.length = 0;
    const gen = currentGen(client, SUB);

    await h.todos.findAll(SUB, {});
    const one = await h.todos.findOne(SUB, t.id);

    expect(one.title).toBe('one');
    expect(one.tagIds).toEqual([1]);
    expect(loaderCalls(h, 'todo')).toBe(1); // served from the hit
    expect(client.setCalls).toEqual([`todo:${SUB}:v${gen}:all`]);
  });

  it('every successful write bumps the owner generation exactly once; a failed write never bumps', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));

    const created = await h.todos.create(SUB, { title: 'bumpable' });
    expect(client.incrCalls).toEqual([generationKey(SUB)]);

    client.incrCalls.length = 0;
    await h.todos.update(SUB, created.id, { title: 'bumped' });
    expect(client.incrCalls).toEqual([generationKey(SUB)]);

    client.incrCalls.length = 0;
    await h.todos.remove(SUB, created.id);
    expect(client.incrCalls).toEqual([generationKey(SUB)]);

    client.incrCalls.length = 0;
    await expect(h.todos.update(SUB, 'missing-id', { title: 'nope' })).rejects.toThrow();
    await expect(h.lists.remove(SUB, 'missing-id')).rejects.toThrow();
    expect(client.incrCalls).toHaveLength(0);
  });

  it('a list write that changes importantDefault bumps todo:gen:<sub> exactly once; a read never bumps', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const l = await h.lists.create(SUB, 'Bump-default', false);

    // A read populates the cache from the DB but must not advance the counter.
    client.incrCalls.length = 0;
    const gen = currentGen(client, SUB);
    await h.lists.list(SUB);
    expect(currentGen(client, SUB)).toBe(gen);
    expect(client.incrCalls).toHaveLength(0);

    // The `importantDefault` write invalidates once for the whole owner.
    client.incrCalls.length = 0;
    await h.lists.update(SUB, l.id, 'Bump-default', true);
    expect(client.incrCalls).toEqual([generationKey(SUB)]);
    expect(currentGen(client, SUB)).toBe(gen + 1);
  });

  it('the four trash writes bump todo:gen:<sub> after the mutation; a failed trash write never bumps', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const gen = generationKey(SUB);

    const a = await h.todos.create(SUB, { title: 'trash-a' });
    const b = await h.todos.create(SUB, { title: 'trash-b' });
    const c = await h.todos.create(SUB, { title: 'trash-c' });

    // soft `remove`
    client.incrCalls.length = 0;
    await h.todos.remove(SUB, a.id);
    expect(client.incrCalls).toEqual([gen]);

    // `restore`
    client.incrCalls.length = 0;
    await h.todos.restore(SUB, a.id);
    expect(client.incrCalls).toEqual([gen]);

    // `removePermanent`
    await h.todos.remove(SUB, b.id);
    await h.todos.remove(SUB, c.id);
    client.incrCalls.length = 0;
    await h.todos.removePermanent(SUB, b.id);
    expect(client.incrCalls).toEqual([gen]);

    // `emptyTrash`
    client.incrCalls.length = 0;
    await h.todos.emptyTrash(SUB);
    expect(client.incrCalls).toEqual([gen]);

    // A trash verb that matches nothing fails closed and never bumps.
    client.incrCalls.length = 0;
    await expect(h.todos.restore(SUB, 'missing-id')).rejects.toThrow();
    await expect(h.todos.removePermanent(SUB, 'missing-id')).rejects.toThrow();
    expect(client.incrCalls).toHaveLength(0);
  });

  it('invalidation: after a write the stale entry is unreachable and a fresh read repopulates', async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));

    await h.todos.findAll(SUB, {});
    expect(client.setCalls).toEqual([`todo:${SUB}:v0:all`]);

    await h.todos.create(SUB, { title: 'after' });
    h.log.length = 0;
    const after = await h.todos.findAll(SUB, {});

    expect(client.setCalls).toContain(`todo:${SUB}:v1:all`);
    expect(after.todos.map((t) => t.title)).toEqual(['after']);
  });

  it("per-owner isolation: one owner's write never bumps another owner's counter", async () => {
    const client = new FakeRedisClient();
    h = await makeUnitHarness(new TodosCache(client));
    const A = 'user-a';
    const B = 'user-b';

    await h.todos.findAll(A, {});
    await h.todos.findAll(B, {});
    expect(client.setCalls).toEqual([`todo:${A}:v0:all`, `todo:${B}:v0:all`]);

    await h.todos.create(A, { title: 'a-only' });
    expect(client.incrCalls).toEqual([generationKey(A)]);
    expect(client.incrCalls).not.toContain(generationKey(B));

    h.log.length = 0;
    await h.todos.findAll(B, {}); // B's entry survives: still a hit
    expect(loaderCalls(h, 'todo')).toBe(0);
  });

  it('fail-open: Redis errors degrade to the DB path for reads and writes', async () => {
    h = await makeUnitHarness(new TodosCache(new FailingRedisClient()));
    const l = await h.lists.create(SUB, 'Resilient');
    const created = await h.todos.create(SUB, { title: 'resilient', listId: l.id, tagIds: [2] });

    const page = await h.todos.findAll(SUB, {});
    expect(page.todos.map((t) => t.title)).toEqual(['resilient']);
    expect((await h.todos.findOne(SUB, created.id)).title).toBe('resilient');
    expect((await h.lists.list(SUB)).map((x) => x.name)).toEqual(['Resilient']);
    expect(await h.todos.listTagUsage(SUB)).toEqual([{ tagId: 2, count: 1 }]);
  });

  it('selection: no REDIS_URL means the direct DB path (loader every call)', async () => {
    const cache = createTodosCache(undefined);
    const loader = jest.fn(async () => [{ id: 'x', title: ENC_PREFIX + 'a.b' }]);
    await cache.getThrough(SUB, TODO_ALL, loader);
    await cache.getThrough(SUB, TODO_ALL, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('pins the three <rest> constants', () => {
    expect([TODO_ALL, TODO_LISTS, TODO_TAGS]).toEqual(['all', 'lists', 'tags']);
  });
});
