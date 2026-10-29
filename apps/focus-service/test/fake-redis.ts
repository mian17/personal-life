import type { CacheClient, CacheSetOptions } from '../src/cache/focus-cache';

/**
 * In-memory stand-in for the node-redis v6 client. It is deliberately *not* a Redis
 * emulator: it implements only the surface `@life/cache` uses (GET, SET … EX, INCR)
 * and records every write and counter bump, so a suite can prove a cache hit skipped
 * the loader, that a write bumped the owner's generation, and that what Redis would
 * hold is the serialized row itself.
 *
 * Mirrors `apps/meal-service/test/fake-redis.ts`; only the namespace differs
 * (`focus`, pinned by `src/cache/focus-cache.ts`).
 */
export class FakeRedisClient implements CacheClient {
  readonly store = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string; options?: CacheSetOptions }> = [];
  readonly incrCalls: string[] = [];

  constructor(readonly events: string[] = []) {}

  get setCalls(): string[] {
    return this.writes.map((write) => write.key);
  }

  /** The one value written under `key`, for the "cached value equals the row" checks. */
  valueFor(key: string): string | undefined {
    return this.writes.find((write) => write.key === key)?.value;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, options?: CacheSetOptions): Promise<'OK'> {
    this.events.push(`set:${key}`);
    this.writes.push({ key, value, options });
    this.store.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.events.push(`incr:${key}`);
    this.incrCalls.push(key);
    const next = (Number.parseInt(this.store.get(key) ?? '0', 10) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }
}

/**
 * Redis unreachable: every command rejects, while the attempts are still counted.
 * Used to prove the fail-open contract — a read is answered from the database, no
 * populate is attempted, and a write still lands even though its bump cannot reach
 * Redis. Counting is what separates "no populate was attempted" from "a populate was
 * attempted and swallowed", which a plain throwing client cannot distinguish.
 */
export class UnreachableRedisClient implements CacheClient {
  readonly gets: string[] = [];
  readonly sets: string[] = [];
  readonly incrs: string[] = [];

  async get(key: string): Promise<string | null> {
    this.gets.push(key);
    throw new Error('redis unreachable');
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.sets.push(key);
    void value;
    throw new Error('redis unreachable');
  }

  async incr(key: string): Promise<number> {
    this.incrs.push(key);
    throw new Error('redis unreachable');
  }
}
