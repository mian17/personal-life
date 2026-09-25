import {
  CACHE_TTL_SECONDS,
  GENERATION_KEY,
  createNotesCache,
  hashOptions,
  NotesCache,
} from '../src/notes/notes-cache';
import { NotesService } from '../src/notes/notes.service';
import { FakeRedisClient, FailingRedisClient } from './fake-redis';

/**
 * Unit-level contract for the note read-through cache. The DB is a repository
 * spy — these tests prove *when* the repository is consulted and *what* is
 * written to Redis, without a database or a live Redis. The behavioural gates
 * for CRUD stay in notes.e2e-spec.ts.
 */

const ISO = '2024-01-01T00:00:00.000Z';

function noteEntity(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'n1',
    body: 'hello',
    version: 0,
    deletedAt: null,
    tags: [],
    createdAt: new Date(ISO),
    updatedAt: new Date(ISO),
    ...overrides,
  };
}

function chainable(opts: {
  events: string[];
  onTerminal: string;
  getMany?: () => Promise<unknown[]>;
  getOne?: () => Promise<unknown>;
}): any {
  const b: any = {};
  for (const m of [
    'leftJoinAndSelect',
    'innerJoin',
    'orderBy',
    'addOrderBy',
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
  b.getOne = jest.fn(async () => {
    opts.events.push(opts.onTerminal);
    return opts.getOne ? opts.getOne() : null;
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
    tagRows: any[];
    deleteAffected: number;
    /** Awaited by every DB mutation; lets a test hold a write open. */
    mutationGate: (() => Promise<void>) | null;
  };
  notes: any;
  tags: any;
  events: string[];
}

function makeHarness(cache: NotesCache, events: string[] = []): Harness {
  const state: Harness['state'] = {
    noteRows: [noteEntity()],
    findOneResult: null,
    getManyImpl: null,
    tagRows: [],
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

  const tags: any = {
    createQueryBuilder: jest.fn(() =>
      chainable({
        events,
        onTerminal: 'db:tags',
        getMany: () => Promise.resolve(state.tagRows),
        getOne: () => Promise.resolve(null),
      }),
    ),
    create: jest.fn((data: any) => ({ id: 1, ...data })),
    save: jest.fn(async (tag: any) => tag),
  };

  const service = new NotesService(notes, tags, cache);
  return { service, cache, state, notes, tags, events };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('NotesCache (read-through + generation invalidation)', () => {
  describe('hit: identical reads are served from cache', () => {
    it('findAll twice consults the repository once and writes one v0 key with a 60s TTL', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));

      const first = await h.service.findAll({});
      const second = await h.service.findAll({});

      expect(first).toEqual(second);
      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets).toHaveLength(1);
      expect(client.sets[0].key).toMatch(/^note:v0:list:[0-9a-f]{16}$/);
      expect(client.sets[0].options).toEqual({ EX: CACHE_TTL_SECONDS });
    });

    it('findTrash twice consults the repository once', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.noteRows = [noteEntity({ deletedAt: new Date(ISO) })];

      await h.service.findTrash({});
      await h.service.findTrash({});

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toMatch(/^note:v0:trash:[0-9a-f]{16}$/);
    });

    it('findOne twice consults the repository once', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.findOneResult = noteEntity();

      const first = await h.service.findOne('n1');
      const second = await h.service.findOne('n1');

      expect(first).toEqual(second);
      expect(h.notes.findOne).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toBe('note:v0:one:n1');
    });

    it('listTags twice consults the repository once', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.tagRows = [{ id: 1, name: 'work' }];

      const first = await h.service.listTags();
      const second = await h.service.listTags();

      expect(first).toEqual(second);
      expect(h.tags.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(client.sets[0].key).toBe('note:v0:tags');
    });

    it('distinct read shapes occupy distinct keys (no filter bleed)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));

      await h.service.findAll({ tag: 'work' });
      await h.service.findAll({ tag: 'idea' });
      await h.service.findAll({ tag: 'work' });

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(new Set(client.setCalls).size).toBe(2);
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
        run: (service) => service.create('created', []),
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
        run: (service) => service.update('n1', 'updated'),
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
        run: (service) => service.remove('n1'),
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
        run: (service) => service.restore('n1'),
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
        run: (service) => service.removePermanent('n1'),
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
        run: (service) => service.emptyTrash(),
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

        const before = await h.service.findAll({});
        expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(before).toBeDefined();

        events.length = 0;
        await run(h.service, h);

        // Ordering property: exactly one bump, emitted *after* the durable DB
        // mutation. Bump-before would leave a window where a concurrent read
        // caches pre-mutation state under the new generation.
        expect(client.incrCalls).toEqual([GENERATION_KEY]);
        const mutationAt = events.indexOf(mutation);
        const bumpAt = events.indexOf(`incr:${GENERATION_KEY}`);
        expect(mutationAt).toBeGreaterThanOrEqual(0);
        expect(bumpAt).toBeGreaterThan(mutationAt);

        after(h);
        const afterRead = await h.service.findAll({});
        expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
        assertRead(afterRead);
      },
    );

    it('a failed mutation does not bump (cache stays consistent)', async () => {
      const client = new FakeRedisClient();
      const h = makeHarness(new NotesCache(client));
      h.state.findOneResult = noteEntity({ version: 5 });

      // Stale expectedVersion → ConflictException, no DB mutation, no bump.
      await expect(h.service.update('n1', 'nope', undefined, 0)).rejects.toThrow();
      expect(client.incrCalls).toHaveLength(0);

      // removePermanent on a note not in trash → 404, no bump.
      h.state.deleteAffected = 0;
      await expect(h.service.removePermanent('missing')).rejects.toThrow();
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

      const firstRead = h.service.findAll({});
      await flush();
      expect(started).toBe(true);

      // A write lands while the DB query is still in flight.
      await h.service.create('raced', []);

      resolveRows([noteEntity({ body: 'raced' })]);
      await firstRead;

      // The stale value must not be cached under the new generation.
      expect(client.setCalls.filter((k) => k.startsWith('note:v0:list:'))).toHaveLength(0);
      expect(client.setCalls).not.toContain('note:v1:list:' + hashOptions({})); // never the new gen either

      // The next read misses and observes the freshly-stored state.
      h.state.getManyImpl = null;
      h.state.noteRows = [noteEntity({ body: 'raced' })];
      const second = await h.service.findAll({});
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

      const writePromise = h.service.create('raced', []);
      await flush();
      expect(gateEntered).toBe(true);

      // A read lands in that window. Under bump-before the generation would
      // already be N+1 here, so this read would cache pre-mutation state under
      // the NEW generation and pin it for the TTL. Under bump-after no bump has
      // run yet, so the entry is created under the OLD generation and is
      // unreachable as soon as the write bumps.
      const during = await h.service.findAll({});
      expect(during.notes[0].body).toBe('old');
      expect(client.setCalls).toEqual([`note:v0:list:${hashOptions({})}`]);
      expect(client.setCalls.some((k) => k.startsWith('note:v1:list:'))).toBe(false);

      releaseGate();
      await writePromise;

      // The write is durable and bumped; the entry cached mid-write (old gen)
      // is now dead, so the next read misses and observes the new state.
      h.state.mutationGate = null;
      h.state.noteRows = [noteEntity({ body: 'raced' })];
      const after = await h.service.findAll({});
      expect(after.notes[0].body).toBe('raced');
      expect(client.setCalls).toContain(`note:v1:list:${hashOptions({})}`);
    });
  });

  describe('fail-open: Redis errors degrade to the DB path', () => {
    it('reads still return DB data and never throw', async () => {
      const h = makeHarness(new NotesCache(new FailingRedisClient()));
      h.state.findOneResult = noteEntity();

      const page = await h.service.findAll({});
      expect(page.notes[0].body).toBe('hello');
      const one = await h.service.findOne('n1');
      expect(one.id).toBe('n1');
      const tags = await h.service.listTags();
      expect(tags).toEqual([]);
    });

    it('writes still mutate the DB when the bump cannot reach Redis', async () => {
      const h = makeHarness(new NotesCache(new FailingRedisClient()));
      h.state.findOneResult = noteEntity();

      await expect(h.service.create('x', [])).resolves.toBeDefined();
      await expect(h.service.update('n1', 'y')).resolves.toBeDefined();
      await expect(h.service.remove('n1')).resolves.toBeUndefined();
      await expect(h.service.restore('n1')).resolves.toBeDefined();
      await expect(h.service.removePermanent('n1')).resolves.toBeUndefined();
      await expect(h.service.emptyTrash()).resolves.toEqual({ count: 1 });

      expect(h.notes.save).toHaveBeenCalled();
      expect(h.notes.delete).toHaveBeenCalled();
    });
  });

  describe('selection: REDIS_URL unset is today\'s direct path', () => {
    it('createNotesCache(undefined) performs no caching', async () => {
      const h = makeHarness(createNotesCache(undefined));

      await h.service.findAll({});
      await h.service.findAll({});

      expect(h.notes.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('a null client cache calls the loader every time', async () => {
      const loader = jest.fn(async () => ({ ok: true }));
      const cache = new NotesCache(null);

      await cache.getThrough('note:one:x', loader);
      await cache.getThrough('note:one:x', loader);

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
