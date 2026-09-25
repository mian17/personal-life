import type { CacheClient } from '../src/users/users-cache';

/**
 * In-memory stand-in for the node-redis client, used to prove cache behavior
 * without a real Redis (the repo's default runs must stay Redis-free). It
 * implements the same tiny surface the app codes against — `get`/`set(EX)`/`del`
 * — and tracks TTLs so the positive/negative TTL contract is assertable.
 *
 * The `fail*` flags inject Redis outages to exercise the fail-open rule.
 */
export class FakeCacheClient implements CacheClient {
  readonly store = new Map<string, string>();
  /** key → absolute expiry (epoch ms); absent means no expiry. */
  readonly expiresAt = new Map<string, number>();
  /** key → the TTL (seconds) last requested, for assertions. */
  readonly ttlSeconds = new Map<string, number>();
  /**
   * Every key ever passed to `set`, including ones later deleted by an
   * invalidation. Lets a test assert the cache's whole keyspace (nothing outside
   * `idp:user:` may ever be written).
   */
  readonly writtenKeys = new Set<string>();

  getCalls = 0;
  setCalls = 0;
  delCalls = 0;

  failReads = false;
  failWrites = false;
  failDeletes = false;

  async get(key: string): Promise<string | null> {
    this.getCalls++;
    if (this.failReads) throw new Error('fake redis: get failed');
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry <= Date.now()) {
      this.store.delete(key);
      this.expiresAt.delete(key);
      this.ttlSeconds.delete(key);
      return null;
    }
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, options: { EX: number }): Promise<unknown> {
    this.setCalls++;
    if (this.failWrites) throw new Error('fake redis: set failed');
    this.writtenKeys.add(key);
    this.store.set(key, value);
    this.ttlSeconds.set(key, options.EX);
    this.expiresAt.set(key, Date.now() + options.EX * 1000);
    return 'OK';
  }

  async del(key: string): Promise<unknown> {
    this.delCalls++;
    if (this.failDeletes) throw new Error('fake redis: del failed');
    const existed = this.store.delete(key);
    this.expiresAt.delete(key);
    this.ttlSeconds.delete(key);
    return existed ? 1 : 0;
  }

  async close(): Promise<void> {
    this.store.clear();
    this.expiresAt.clear();
    this.ttlSeconds.clear();
  }
}
