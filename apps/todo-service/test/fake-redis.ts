import type { CacheClient, CacheSetOptions } from '../src/cache/todo-cache';

/**
 * In-memory stand-in for the node-redis v6 client. It is deliberately *not* a
 * Redis emulator: it implements only the surface `todo-cache` uses
 * (GET/SET EX/INCR/connect) and records the SET/INCR traffic so tests can prove
 * a cache hit skipped the repository and that a stale populate was suppressed.
 */
export class FakeRedisClient implements CacheClient {
  readonly store = new Map<string, string>();
  readonly sets: Array<{ key: string; options?: CacheSetOptions }> = [];
  readonly incrCalls: string[] = [];

  constructor(readonly events: string[] = []) {}

  get setCalls(): string[] {
    return this.sets.map((entry) => entry.key);
  }

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, options?: CacheSetOptions): Promise<'OK'> {
    this.events.push(`set:${key}`);
    this.sets.push({ key, options });
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

  async connect(): Promise<this> {
    return this;
  }

  on(): this {
    return this;
  }
}

/**
 * Every command rejects, modelling Redis being unreachable. Used to prove the
 * fail-open contract: reads fall through to the DB and writes still land
 * (a generation bump that cannot reach Redis must never block the mutation).
 */
export class FailingRedisClient implements CacheClient {
  async get(): Promise<string | null> {
    throw new Error('redis unreachable');
  }

  async set(): Promise<'OK'> {
    throw new Error('redis unreachable');
  }

  async incr(): Promise<number> {
    throw new Error('redis unreachable');
  }

  async connect(): Promise<this> {
    throw new Error('redis unreachable');
  }

  on(): this {
    throw new Error('redis unreachable');
  }
}
