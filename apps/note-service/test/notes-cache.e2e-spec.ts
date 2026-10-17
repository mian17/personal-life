import {
  CACHE_TTL_SECONDS,
  createNotesCache,
  generationKey,
  NotesCache,
} from '../src/notes/notes-cache';
import { NotesService } from '../src/notes/notes.service';
import { KeysService } from '../src/keys/keys.service';
import { ENC_PREFIX, encryptField, generateDek, wrapDek } from '@life/crypto';
import { FakeRedisClient, FailingRedisClient } from './fake-redis';

/**
 * Unit-level contract for the note read-through cache. The DB is a repository
 * spy — these tests prove *when* the repository is consulted and *what* is
 * written to Redis, without a database or a live Redis. The behavioural gates
 * for CRUD stay in notes.e2e-spec.ts.
 *
 * `notes-at-rest` T5: every cached **content** value is a serialized ciphertext
 * row (`enc.v1.` envelopes), never a decrypted DTO. `SPEC-tags-extraction`
 * narrows the ciphertext-only assertion scope to content rows: the `note:tags`
 * entry is the used-`tagId`+count metadata (ids and counts carry no plaintext).
 * Fixtures build rows with the real `@life/crypto` package and a spy
 * `KeysService`, so the cache-hit path genuinely decrypts and the no-plaintext
 * assertions inspect the raw strings written to Redis.
 *
 * Every key embeds the owner sub and the generation counter is per-user, so one
 * user's writes neither invalidate nor populate another user's entries.
 */

const ISO = '2024-01-01T00:00:00.000Z';

/** The single sub the ordering / stale-guard / fail-open cases run under. */
const SUB = 'sub-1';

const MASTER_KEY = Buffer.alloc(32, 0x2a);
const DEK = generateDek();

/** AAD shape copied from `SPEC-notes-at-rest` (the cross-module contract). */
const noteAad = (sub: string, id: string): string => `life.v1|${sub}|note|body|${id}`;

/**
 * A stored note row: content is the `body` envelope (built from a plaintext
 * override) and associations are `noteTags` TagRef rows (`tagIds`).
 */
function noteEntity(overrides: Record<string, unknown> = {}): any {
  const { body = 'hello', tagIds = [], ...rest } = overrides as any;
  const id = (rest.id as string) ?? 'n1';
  const ownerSub = (rest.ownerSub as string | null | undefined) ?? SUB;
  return {
    id,
    ownerSub,
    body: encryptField(DEK, String(body), noteAad(ownerSub ?? SUB, id)),
    version: 0,
    deletedAt: null,
    noteTags: (tagIds as number[]).map((tagId) => ({ noteId: id, tagId })),
    createdAt: new Date(ISO),
    updatedAt: new Date(ISO),
    ...rest,
  };
}

/**
 * A ciphertext row as a pre-deploy Redis entry held it: ISO dates and no
 * `contentUpdatedAt` field at all. Built from `noteEntity`, so `body` is a real
 * `enc.v1.` envelope and the decoder's tolerance is exercised on genuine content.
 */
function cachedRowSeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const entity: any = noteEntity(overrides);
  return {
    id: entity.id,
    ownerSub: entity.ownerSub,
    body: entity.body,
    version: entity.version,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt ? entity.deletedAt.toISOString() : null,
    tagIds: entity.noteTags.map((nt: any) => nt.tagId),
  };
}

/**
 * A real `KeysService` over a spy `user_keys` repo that always resolves the same
 * DEK. Memoization is per-instance, so each harness gets its own — but the DEK is
 * identical, which is all the fixtures need.
 */
function makeKeysService(): KeysService {
  const userKeys: any = {
    findOne: jest.fn(async ({ where }: any) => ({
      sub: where.sub,
      wrappedDek: wrapDek(DEK, MASTER_KEY),
      kekVersion: 1,
      createdAt: new Date(),
    })),
    insert: jest.fn(),
  };
  return new KeysService(userKeys, MASTER_KEY);
}

/**
 * A `FakeRedisClient` that also records every raw value written, so a test can
 * assert the serialized content payloads contain `enc.v1.` and no known plaintext.
 */
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

function chainable(opts: {
  events: string[];
  onTerminal: string;
  getMany?: () => Promise<unknown[]>;
  getRawMany?: () => Promise<unknown[]>;
}): any {
  const b: any = {};
  for (const m of [
    'leftJoinAndSelect',
    'innerJoin',
    'select',
    'addSelect',
    'orderBy',
    'addOrderBy',
    'groupBy',
    'where',
    'andWhere',
    'take',
  ]) {
    b[m] = jest.fn(() => b);
  }
  b.getMany = jest.fn(async () => {
    opts.events.push(opts.onTerminal);
    return opts.getMany ? opts.getMany() : [];
  });
  b.getRawMany = jest.fn(async () => {
    opts.events.push(opts.onTerminal);
    return opts.getRawMany ? opts.getRawMany() : [];
  });
  return b;
}

interface Harness {
  service: NotesService;
  cache: NotesCache;
  state: {
    noteRows: any[];
    findOneResult: any;
    getManyImpl: (() => Promise<any[]>) | null;
    /** The `note:tags` loader's `getRawMany()` output: `[{tagId, count}]`. */
    tagUsageRows: Array<{ tagId: number; count: number }>;
    deleteAffected: number;
    /** Awaited by every DB mutation; lets a test hold a write open. */
    mutationGate: (() => Promise<void>) | null;
  };
  notes: any;
  noteTags: any;
  events: string[];
}

function makeHarness(cache: NotesCache, events: string[] = []): Harness {
  const state: Harness['state'] = {
    noteRows: [noteEntity()],
    findOneResult: null,
    getManyImpl: null,
    tagUsageRows: [],
    deleteAffected: 1,
    mutationGate: null,
  };

  const notes: any = {
    createQueryBuilder: jest.fn(() =>
      chainable({
        events,
        onTerminal: 'db:list',
        getMany: () =>
          state.getManyImpl ? state.getManyImpl() : Promise.resolve(state.noteRows),
      }),
    ),
    findOne: jest.fn(async () => {
      events.push('db:findOne');
      return state.findOneResult;
    }),
    create: jest.fn((data: any) => {
      events.push('db:create');
      return { ...noteEntity(), ...data };
    }),
    save: jest.fn(async (note: any) => {
      events.push('db:save');
      if (state.mutationGate) await state.mutationGate();
      return note;
    }),
    delete: jest.fn(async () => {
      events.push('db:delete');
      if (state.mutationGate) await state.mutationGate();
      return { affected: state.deleteAffected };
    }),
  };

  const noteTagRows: Array<{ noteId: string; tagId: number }> = [];
  const noteTags: any = {
    createQueryBuilder: jest.fn(() =>
      chainable({
        events,
        onTerminal: 'db:tags',
        getRawMany: () => Promise.resolve(state.tagUsageRows),
      }),
    ),
    find: jest.fn(async (opts: any) =>
      noteTagRows.filter((r) => r.noteId === (opts?.where?.noteId ?? opts?.noteId)),
    ),
    insert: jest.fn(async (rows: any) => {
      noteTagRows.push(...([] as any[]).concat(rows));
      return { identifiers: [] };
    }),
    delete: jest.fn(async (opts: any) => {
      const noteId = opts?.where?.noteId ?? opts?.noteId;
      const before = noteTagRows.length;
      const keep = noteTagRows.filter((r) => r.noteId !== noteId);
      noteTagRows.length = 0;
      noteTagRows.push(...keep);
      return { affected: before - keep.length };
    }),
  };

  const service = new NotesService(notes, noteTags, cache, makeKeysService());
  return { service, cache, state, notes, noteTags, events };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('NotesCache (read-through + generation invalidation)', () => {
  describe('hit: identical reads are served from cache (decrypted after the hit)', () => {
    it('findAll twice consults the repository once and writes one v0 ciphertext-row key with a 60s TTL', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));

      const first = await h.service.findAll(SUB, {});
      const second = await h.service.findAll(SUB, {});

      // The API output is byte-identical across a miss and a hit.
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.notes[0].body).toBe('hello');
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets).toHaveLength(1);
      expect(client.sets[0].key).toBe(`note:${SUB}:v0:list`);
      expect(client.sets[0].options).toEqual({ EX: CACHE_TTL_SECONDS });
      // The stored value is ciphertext rows, not decrypted DTOs.
      expect(client.values[0].value).toContain(ENC_PREFIX);
      expect(client.values[0].value).not.toContain('hello');
    });

    it('findTrash twice consults the repository once', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.noteRows = [noteEntity({ id: 't1', deletedAt: new Date(ISO) })];

      await h.service.findTrash(SUB, {});
      await h.service.findTrash(SUB, {});

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toBe(`note:${SUB}:v0:trash`);
    });

    it('findOne twice consults the repository once and returns decrypted content on the hit', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.findOneResult = noteEntity({ body: 'secret body', tagIds: [7] });

      const first = await h.service.findOne(SUB, 'n1');
      const second = await h.service.findOne(SUB, 'n1');

      expect(first.body).toBe('secret body');
      expect(first.tagIds).toEqual([7]);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(h.notes.findOne).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toBe(`note:${SUB}:v0:one:n1`);
      // The cached value is the ciphertext row, never the decrypted DTO.
      expect(client.values[0].value).toContain(ENC_PREFIX);
      expect(client.values[0].value).not.toContain('secret body');
    });

    it('listTagUsage twice consults the repository once and returns [{tagId, count}] metadata', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.tagUsageRows = [
        { tagId: 2, count: 3 },
        { tagId: 1, count: 5 },
      ];

      const first = await h.service.listTagUsage(SUB);
      const second = await h.service.listTagUsage(SUB);

      expect(first).toEqual([
        { tagId: 2, count: 3 },
        { tagId: 1, count: 5 },
      ]);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(h.noteTags.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toBe(`note:${SUB}:v0:tags`);
      // Metadata-only by design: ids + counts carry no plaintext, so this is the
      // one shape that legitimately holds no `enc.v1.` envelope.
      expect(client.values[0].value).toContain('"tagId":1');
      expect(client.values[0].value).toContain('"count":5');
      expect(client.values[0].value).not.toContain(ENC_PREFIX);
    });

    it('applies q and tagId filtering to a cache hit (post-decrypt, one loader call)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      // Distinct timestamps: the list now ranks in memory, so equal dates would
      // hand the order to the `id DESC` tie-break instead of the fixture.
      h.state.noteRows = [
        noteEntity({
          id: 'n1',
          body: 'alpha note',
          tagIds: [1],
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
        }),
        noteEntity({
          id: 'n2',
          body: 'beta note',
          tagIds: [2],
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        }),
      ];

      const all = await h.service.findAll(SUB, {});
      const byQ = await h.service.findAll(SUB, { q: 'alpha' });
      const byTag = await h.service.findAll(SUB, { tagId: 2 });

      expect(all.notes.map((n) => n.body)).toEqual(['alpha note', 'beta note']);
      expect(byQ.notes.map((n) => n.body)).toEqual(['alpha note']);
      expect(byTag.notes.map((n) => n.body)).toEqual(['beta note']);
      // The filter variants were served from the single cached row set.
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('q / tagId / limit / cursor do not enter the key space (one entry serves every variant)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));

      await h.service.findAll(SUB, { q: 'a' });
      await h.service.findAll(SUB, { tagId: 1 });
      await h.service.findAll(SUB, { limit: 1, cursor: 'x' });

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.setCalls).toEqual([`note:${SUB}:v0:list`]);
    });

    it('generation bump makes the stale ciphertext entry unreachable; a fresh read repopulates', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));

      await h.service.findAll(SUB, {});
      expect(client.setCalls).toEqual([`note:${SUB}:v0:list`]);

      // A write bumps to v1; the v0 entry can no longer be addressed.
      await h.service.create(SUB, 'x', []);
      h.state.noteRows = [noteEntity({ id: 'n9', body: 'after bump' })];
      const after = await h.service.findAll(SUB, {});

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(after.notes[0].body).toBe('after bump');
      expect(client.setCalls).toContain(`note:${SUB}:v1:list`);
    });
  });

  describe('ciphertext-only: content rows never write plaintext to Redis', () => {
    /**
     * Populate all four cache shapes through the service and assert on the raw
     * serialized strings. The three **content** shapes (list/trash/one) must
     * carry `enc.v1.` and no known plaintext; the `note:tags` shape is
     * metadata-only by design (`SPEC-tags-extraction`).
     */
    it('list / trash / one serialize ciphertext only; tags is metadata-only', async () => {
      const BODY = 'TOPSECRET-NOTE-BODY';
      const NAME = 'TOPSECRET-TAG-NAME';
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      const row = noteEntity({ id: 'n1', body: BODY, tagIds: [5] });
      h.state.noteRows = [row];
      h.state.findOneResult = row;
      h.state.tagUsageRows = [{ tagId: 5, count: 1 }];

      await h.service.findAll(SUB, {});
      await h.service.findTrash(SUB, {});
      await h.service.findOne(SUB, 'n1');
      await h.service.listTagUsage(SUB);

      const keys = client.values.map((v) => v.key);
      expect(keys).toEqual([
        `note:${SUB}:v0:list`,
        `note:${SUB}:v0:trash`,
        `note:${SUB}:v0:one:n1`,
        `note:${SUB}:v0:tags`,
      ]);
      expect(client.values).toHaveLength(4);
      const contentValues = client.values.filter((v) => !v.key.endsWith(':tags'));
      for (const { value } of contentValues) {
        expect(value).toContain(ENC_PREFIX);
        expect(value).not.toContain(BODY);
      }
      // The metadata entry holds ids/counts only — no ciphertext, no tag name
      // (note-service never stores names at all).
      const tagsValue = client.values.find((v) => v.key.endsWith(':tags'))!;
      expect(tagsValue.value).not.toContain(ENC_PREFIX);
      expect(tagsValue.value).not.toContain(BODY);
      expect(tagsValue.value).not.toContain(NAME);
    });

    it('serves a legacy plaintext row directly but refuses to cache it', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      // A pre-backfill row: body is not an envelope (dual-read, D8).
      h.state.noteRows = [
        {
          id: 'legacy',
          ownerSub: SUB,
          body: 'legacy plaintext body',
          version: 0,
          deletedAt: null,
          noteTags: [],
          createdAt: new Date(ISO),
          updatedAt: new Date(ISO),
        },
      ];

      const page = await h.service.findAll(SUB, {});

      expect(page.notes[0].body).toBe('legacy plaintext body');
      // The loader's result is returned, but nothing was written to Redis.
      expect(client.values).toHaveLength(0);
      expect(client.setCalls).toHaveLength(0);
    });

    it('discards a legacy/plaintext entry already in Redis and rewrites ciphertext', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.noteRows = [noteEntity({ id: 'n1', body: 'fresh ciphertext' })];
      const key = `note:${SUB}:v0:list`;

      // A leftover plaintext entry from a pre-fix deploy.
      client.store.set(key, JSON.stringify([{ id: 'n1', body: 'old plaintext', tagIds: [] }]));

      const page = await h.service.findAll(SUB, {});

      expect(page.notes[0].body).toBe('fresh ciphertext');
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      // The unusable entry was overwritten with ciphertext rows.
      const written = client.values.filter((v) => v.key === key);
      expect(written).toHaveLength(1);
      expect(written[0].value).toContain(ENC_PREFIX);
      expect(written[0].value).not.toContain('old plaintext');
    });
  });

  describe('content order: the cached row carries the ranking timestamp', () => {
    const editedAt = '2024-05-01T00:00:00.000Z';

    it('serializes contentUpdatedAt beside the ciphertext row it ranks', async () => {
      const PLAINTEXT = 'CONTENT-ORDER-SECRET';
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.noteRows = [noteEntity({ body: PLAINTEXT, contentUpdatedAt: new Date(editedAt) })];

      await h.service.findAll(SUB, {});

      const written = client.values[0].value;
      expect(JSON.parse(written)[0].contentUpdatedAt).toBe(editedAt);
      // The ranking timestamp rides inside the same ciphertext-only payload: no
      // new plaintext surface, the body envelope is still the only content.
      expect(written).toContain(ENC_PREFIX);
      expect(written).not.toContain(PLAINTEXT);
    });

    it('decodes a cached row missing contentUpdatedAt and ranks it by createdAt', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      const key = `note:${SUB}:v0:list`;
      client.store.set(
        key,
        JSON.stringify([
          cachedRowSeed({ id: 'n-legacy', body: 'legacy birth' }),
          {
            ...cachedRowSeed({
              id: 'n-newer',
              body: 'newer birth',
              createdAt: new Date('2024-01-02T00:00:00.000Z'),
            }),
            contentUpdatedAt: editedAt,
          },
        ]),
      );

      const page = await h.service.findAll(SUB, {});

      expect(h.notes.createQueryBuilder).not.toHaveBeenCalled();
      expect(page.notes.map((note) => note.id)).toEqual(['n-newer', 'n-legacy']);
      expect(page.notes.find((note) => note.id === 'n-legacy')!.body).toBe('legacy birth');
    });

    it('serializes contentUpdatedAt on the trash and one entries too', async () => {
      const client = new CapturingRedisClient();
      const h = makeHarness(new NotesCache(client));
      const row = noteEntity({
        id: 'n1',
        body: 'trashed row',
        deletedAt: new Date(editedAt),
        contentUpdatedAt: new Date(editedAt),
      });
      h.state.noteRows = [row];
      h.state.findOneResult = row;

      await h.service.findTrash(SUB, {});
      await h.service.findOne(SUB, 'n1');

      const trashValue = client.values.find((v) => v.key === `note:${SUB}:v0:trash`)!.value;
      const oneValue = client.values.find((v) => v.key === `note:${SUB}:v0:one:n1`)!.value;
      expect(JSON.parse(trashValue)[0].contentUpdatedAt).toBe(editedAt);
      expect(JSON.parse(oneValue).contentUpdatedAt).toBe(editedAt);
      expect(trashValue).toContain(ENC_PREFIX);
      expect(oneValue).toContain(ENC_PREFIX);
    });

    it('reorders a body-edited note to the top on the loader and cached paths after the generation bump', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      const older = noteEntity({
        id: 'n-older',
        body: 'older',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        contentUpdatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      const newer = noteEntity({
        id: 'n-newer',
        body: 'newer',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        contentUpdatedAt: new Date('2024-01-02T00:00:00.000Z'),
      });
      h.state.noteRows = [older, newer];

      // v0: the newer note leads, and that row set is cached.
      const before = await h.service.findAll(SUB, {});
      expect(before.notes.map((n) => n.id)).toEqual(['n-newer', 'n-older']);
      expect(client.setCalls).toEqual([`note:${SUB}:v0:list`]);

      // A body edit bumps to v1 and gives the older note the newest stamp.
      h.state.findOneResult = older;
      await h.service.update(SUB, 'n-older', 'older edited');
      h.state.noteRows = [
        noteEntity({
          id: 'n-older',
          body: 'older edited',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          contentUpdatedAt: new Date('2024-03-01T00:00:00.000Z'),
        }),
        newer,
      ];

      // Loader path: v1 misses, the reload reorders, and the fresh set is cached.
      const loaded = await h.service.findAll(SUB, {});
      expect(loaded.notes.map((n) => n.id)).toEqual(['n-older', 'n-newer']);
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(client.setCalls).toContain(`note:${SUB}:v1:list`);

      // Cached path: the next read is a v1 hit that keeps the new order.
      const cached = await h.service.findAll(SUB, {});
      expect(cached.notes.map((n) => n.id)).toEqual(['n-older', 'n-newer']);
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidation: every write bumps the generation', () => {
    const cases: Array<{
      name: string;
      setup: (h: Harness) => void;
      run: (service: NotesService, h: Harness) => Promise<unknown>;
      after: (h: Harness) => void;
      /** The repository event that marks the durable DB mutation. */
      mutation: string;
      assertRead: (page: { notes: Array<{ body: string }> }) => void;
    }> = [
      {
        name: 'create',
        setup: () => undefined,
        run: (service) => service.create(SUB, 'created', []),
        after: (h) => {
          h.state.noteRows = [noteEntity({ body: 'created' })];
        },
        mutation: 'db:save',
        assertRead: (page) => expect(page.notes[0].body).toBe('created'),
      },
      {
        name: 'update',
        setup: (h) => {
          h.state.findOneResult = noteEntity({ body: 'before' });
        },
        run: (service) => service.update(SUB, 'n1', 'updated'),
        after: (h) => {
          h.state.noteRows = [noteEntity({ body: 'updated', version: 1 })];
        },
        mutation: 'db:save',
        assertRead: (page) => expect(page.notes[0].body).toBe('updated'),
      },
      {
        name: 'remove',
        setup: (h) => {
          h.state.findOneResult = noteEntity();
        },
        run: (service) => service.remove(SUB, 'n1'),
        after: (h) => {
          h.state.noteRows = [];
        },
        mutation: 'db:save',
        assertRead: (page) => expect(page.notes).toHaveLength(0),
      },
      {
        name: 'restore',
        setup: (h) => {
          h.state.findOneResult = noteEntity({ deletedAt: new Date(ISO) });
        },
        run: (service) => service.restore(SUB, 'n1'),
        after: (h) => {
          h.state.noteRows = [noteEntity({ deletedAt: null })];
        },
        mutation: 'db:save',
        assertRead: (page) => expect(page.notes).toHaveLength(1),
      },
      {
        name: 'removePermanent',
        setup: (h) => {
          h.state.deleteAffected = 1;
          h.state.findOneResult = noteEntity({ deletedAt: new Date(ISO) });
        },
        run: (service) => service.removePermanent(SUB, 'n1'),
        after: (h) => {
          h.state.noteRows = [];
        },
        mutation: 'db:delete',
        assertRead: (page) => expect(page.notes).toHaveLength(0),
      },
      {
        name: 'emptyTrash',
        setup: (h) => {
          h.state.deleteAffected = 2;
          h.state.noteRows = [noteEntity({ deletedAt: new Date(ISO) })];
        },
        run: (service) => service.emptyTrash(SUB),
        after: (h) => {
          h.state.noteRows = [];
        },
        mutation: 'db:delete',
        assertRead: (page) => expect(page.notes).toHaveLength(0),
      },
    ];

    it.each(cases)(
      '$name invalidates a populated read (bump strictly after the DB mutation)',
      async ({ setup, run, after, mutation, assertRead }) => {
        const events: string[] = [];
        const client = new FakeRedisClient(events);
        const h = makeHarness(new NotesCache(client), events);
        setup(h);

        const before = await h.service.findAll(SUB, {});
        expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(before).toBeDefined();

        events.length = 0;
        await run(h.service, h);

        // Ordering property: exactly one bump, emitted *after* the durable DB
        // mutation. Bump-before would leave a window where a concurrent read
        // caches pre-mutation state under the new generation.
        expect(client.incrCalls).toEqual([generationKey(SUB)]);
        const mutationAt = events.indexOf(mutation);
        const bumpAt = events.indexOf(`incr:${generationKey(SUB)}`);
        expect(mutationAt).toBeGreaterThanOrEqual(0);
        expect(bumpAt).toBeGreaterThan(mutationAt);

        after(h);
        const afterRead = await h.service.findAll(SUB, {});
        expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
        assertRead(afterRead);
      },
    );

    it('a failed mutation does not bump (cache stays consistent)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.findOneResult = noteEntity({ version: 5 });

      // Stale expectedVersion → ConflictException, no DB mutation, no bump.
      await expect(h.service.update(SUB, 'n1', 'nope', undefined, 0)).rejects.toThrow();
      expect(client.incrCalls).toHaveLength(0);

      // removePermanent on a note not in trash → 404, no bump.
      h.state.deleteAffected = 0;
      await expect(h.service.removePermanent(SUB, 'missing')).rejects.toThrow();
      expect(client.incrCalls).toHaveLength(0);
    });
  });

  describe('stale-guard: a write during a slow query is not masked', () => {
    it('does not populate the pre-write key when the generation changes mid-query', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));

      let resolveRows: (rows: any[]) => void = () => undefined;
      const pending = new Promise<any[]>((resolve) => {
        resolveRows = resolve;
      });
      let started = false;
      h.state.getManyImpl = () => {
        started = true;
        return pending;
      };

      const firstRead = h.service.findAll(SUB, {});
      await flush();
      expect(started).toBe(true);

      // A write lands while the DB query is still in flight.
      await h.service.create(SUB, 'raced', []);

      resolveRows([noteEntity({ body: 'raced' })]);
      await firstRead;

      // The stale value must not be cached under the new generation.
      expect(client.setCalls).not.toContain(`note:${SUB}:v0:list`);
      expect(client.setCalls).not.toContain(`note:${SUB}:v1:list`); // never the new gen either

      // The next read misses and observes the freshly-stored state.
      h.state.getManyImpl = null;
      h.state.noteRows = [noteEntity({ body: 'raced' })];
      const second = await h.service.findAll(SUB, {});
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(second.notes[0].body).toBe('raced');
    });

    it('closes the bump-before window: a read during the mutation tail is born under the OLD generation', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.noteRows = [noteEntity({ body: 'old' })];

      // Hold the write inside its DB mutation — before the bump.
      let releaseGate: () => void = () => undefined;
      let gateEntered = false;
      h.state.mutationGate = () => {
        gateEntered = true;
        return new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
      };

      const writePromise = h.service.create(SUB, 'raced', []);
      await flush();
      expect(gateEntered).toBe(true);

      // A read lands in that window. Under bump-before the generation would
      // already be N+1 here, so this read would cache pre-mutation state under
      // the NEW generation and pin it for the TTL. Under bump-after no bump has
      // run yet, so the entry is created under the OLD generation and is
      // unreachable as soon as the write bumps.
      const during = await h.service.findAll(SUB, {});
      expect(during.notes[0].body).toBe('old');
      expect(client.setCalls).toEqual([`note:${SUB}:v0:list`]);
      expect(client.setCalls.some((k) => k.startsWith(`note:${SUB}:v1:list`))).toBe(false);

      releaseGate();
      await writePromise;

      // The write is durable and bumped; the entry cached mid-write (old gen)
      // is now dead, so the next read misses and observes the new state.
      h.state.mutationGate = null;
      h.state.noteRows = [noteEntity({ body: 'raced' })];
      const after = await h.service.findAll(SUB, {});
      expect(after.notes[0].body).toBe('raced');
      expect(client.setCalls).toContain(`note:${SUB}:v1:list`);
    });
  });

  describe('isolation: one user\'s writes never reach another user\'s entries', () => {
    it("A's write bumps only note:gen:<a>; B's cached entries survive and still serve", async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      const A = 'user-a';
      const B = 'user-b';
      // An empty row set: this case is about key namespaces, not decryption.
      h.state.noteRows = [];

      // Both users populate their own list entry.
      await h.service.findAll(A, {});
      await h.service.findAll(B, {});
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(client.setCalls).toEqual([
        `note:${A}:v0:list`,
        `note:${B}:v0:list`,
      ]);

      // A writes: exactly A's counter bumps and nothing else.
      await h.service.create(A, 'a-note', []);
      expect(client.incrCalls).toEqual([generationKey(A)]);
      expect(client.incrCalls).not.toContain(generationKey(B));

      // B's entry survived the write: B's next read is still a cache hit.
      await h.service.findAll(B, {});
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);

      // A's entry is unreachable (it holds the old generation), so A misses,
      // re-queries, and repopulates under the new generation.
      await h.service.findAll(A, {});
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(3);
      expect(client.setCalls).toContain(`note:${A}:v1:list`);
    });

    it("a read by one user never populates a key reachable from the other's namespace", async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      const A = 'user-a';
      const B = 'user-b';
      h.state.noteRows = [];

      await h.service.findAll(A, {});
      expect(client.setCalls.length).toBeGreaterThan(0);
      expect(client.setCalls.every((k) => k.startsWith(`note:${A}:`))).toBe(true);
      expect(client.setCalls.some((k) => k.startsWith(`note:${B}:`))).toBe(false);

      await h.service.findAll(B, {});
      const bKeys = client.setCalls.filter((k) => k.startsWith(`note:${B}:`));
      expect(bKeys).toEqual([`note:${B}:v0:list`]);
    });
  });

  describe('fail-open: Redis errors degrade to the DB path', () => {
    it('reads still return DB data and never throw', async () => {
      const h = makeHarness(new NotesCache(new FailingRedisClient()));
      h.state.noteRows = [noteEntity({ body: 'hello', tagIds: [3] })];
      h.state.findOneResult = noteEntity({ body: 'one', tagIds: [3] });
      h.state.tagUsageRows = [{ tagId: 3, count: 1 }];

      const page = await h.service.findAll(SUB, {});
      expect(page.notes[0].body).toBe('hello');
      const one = await h.service.findOne(SUB, 'n1');
      expect(one.body).toBe('one');
      expect(one.tagIds).toEqual([3]);
      const usage = await h.service.listTagUsage(SUB);
      expect(usage).toEqual([{ tagId: 3, count: 1 }]);
    });

    it('writes still mutate the DB when the bump cannot reach Redis', async () => {
      const h = makeHarness(new NotesCache(new FailingRedisClient()));
      h.state.findOneResult = noteEntity();

      await expect(h.service.create(SUB, 'x', [])).resolves.toBeDefined();
      await expect(h.service.update(SUB, 'n1', 'y')).resolves.toBeDefined();
      await expect(h.service.remove(SUB, 'n1')).resolves.toBeUndefined();
      await expect(h.service.restore(SUB, 'n1')).resolves.toBeDefined();
      await expect(h.service.removePermanent(SUB, 'n1')).resolves.toBeUndefined();
      await expect(h.service.emptyTrash(SUB)).resolves.toEqual({ count: 1 });

      expect(h.notes.save).toHaveBeenCalled();
      expect(h.notes.delete).toHaveBeenCalled();
    });
  });

  describe('selection: REDIS_URL unset is today\'s direct path', () => {
    it('createNotesCache(undefined) performs no caching', async () => {
      const h = makeHarness(createNotesCache(undefined));

      await h.service.findAll(SUB, {});
      await h.service.findAll(SUB, {});

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('a null client cache calls the loader every time', async () => {
      const loader = jest.fn(async () => ({ ok: true }));
      const cache = new NotesCache(null);

      await cache.getThrough(SUB, 'note:one:x', loader);
      await cache.getThrough(SUB, 'note:one:x', loader);

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
