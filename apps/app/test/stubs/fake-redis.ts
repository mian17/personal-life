import type { RedisSetOptions, SessionRedisClient } from '@/lib/auth/redis-store';

/**
 * In-memory stand-in for the node-redis command surface the session store uses.
 *
 * Models GET / SET (EX · KEEPTTL · NX) / DEL / EXPIRE against an injected clock
 * with real TTL bookkeeping, so the store contract suite can prove sliding-window
 * and KEEPTTL semantics (and failure behaviour) without a live Redis — dev/e2e
 * stay zero-Redis. `connect`/`on` exist only so the factory-selection test can
 * inject this through the `redis` module mock.
 */

interface Entry {
  value: string;
  /** Key expiry as an epoch-ms instant, or null when the key has no TTL. */
  expiresAt: number | null;
}

export class FakeRedis implements SessionRedisClient {
  private readonly entries = new Map<string, Entry>();
  private failing = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Fail every following command — the injected "Redis is down" client. */
  setFailing(failing: boolean): void {
    this.failing = failing;
  }

  async connect(): Promise<this> {
    return this;
  }

  on(): this {
    return this;
  }

  async get(key: string): Promise<string | null> {
    this.assertAvailable();
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<'OK' | null> {
    this.assertAvailable();
    const existing = this.live(key);
    // NX (used by the refresh lock) only writes when the key is absent.
    if (options.NX && existing) return null;

    let expiresAt: number | null = null;
    if (typeof options.EX === 'number') {
      expiresAt = this.now() + options.EX * 1000;
    } else if (options.KEEPTTL) {
      expiresAt = existing?.expiresAt ?? null;
    }
    this.entries.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.assertAvailable();
    return this.entries.delete(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertAvailable();
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + seconds * 1000;
    return 1;
  }

  /** Test aid: remaining TTL in ms, or null when the key has no expiry. */
  ttlMs(key: string): number | null {
    const entry = this.live(key);
    return entry?.expiresAt == null ? null : entry.expiresAt - this.now();
  }

  /**
   * Test aid: the raw stored value without touching the TTL or sliding anything
   * — lets the contract suite assert `update` preserved the expiry.
   */
  rawValue(key: string): string | null {
    return this.live(key)?.value ?? null;
  }

  /** Test aid: whether the key exists and has not lapsed. */
  has(key: string): boolean {
    return this.live(key) !== undefined;
  }

  private assertAvailable(): void {
    if (this.failing) throw new Error('redis unavailable');
  }

  /** Lazy expiration, exactly as Redis deletes a key once its TTL lapses. */
  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}
