import 'server-only';
import type { AppSession, SessionStoreApi } from './session-store';

/**
 * Redis-backed session store — the shared-state implementation of the
 * `SessionStoreApi` seam (`session-store.ts`). Selected by `createSessionStore()`
 * when `REDIS_URL` is set, so app replicas behave as one service.
 *
 * Fail-closed (recorded decision): with `REDIS_URL` set there is deliberately NO
 * in-memory fallback — per-instance memory in prod is split-brain, worse than a
 * re-login. `get`/`update` swallow client errors to `undefined` (login wall),
 * `destroy` is a silent no-op, and `create` throws `SessionStoreUnavailable`
 * rather than ever returning a half-issued session. Tokens live in the values,
 * so this module is `server-only` and values are never logged.
 */

/** The node-redis `SET` options this store uses (see node-redis `SetOptions`). */
export interface RedisSetOptions {
  /** Expire the key after N seconds (`SET … EX N`). */
  EX?: number;
  /** Keep the key's current TTL (`SET … KEEPTTL`) — used by `update`. */
  KEEPTTL?: boolean;
  /** Only set when the key is absent (`SET … NX`) — used by the refresh lock. */
  NX?: boolean;
}

/**
 * The exact client surface this store depends on. Declared structurally (rather
 * than importing the concrete node-redis type) so tests can inject a fake with
 * no real Redis, and so the cluster-ready `createClient`/`createCluster` types
 * both satisfy it.
 */
export interface SessionRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<unknown>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/** Raised by `create` when the backend is unreachable — callers must fail closed. */
export class SessionStoreUnavailable extends Error {
  constructor(cause?: unknown) {
    super('session store unavailable', { cause });
    this.name = 'SessionStoreUnavailable';
  }
}

/** Record key prefix: JSON of an `AppSession` at `app:sess:<id>`. */
export const SESSION_KEY_PREFIX = 'app:sess:';

export interface RedisSessionStoreOptions {
  /** Sliding window, in ms (the same TTL the in-memory store uses). */
  ttlMs: number;
  /** Injected clock, matching the in-memory store, for deterministic expiry math. */
  now?: () => number;
  /**
   * Resolves once the client is connected. node-redis opens no socket until
   * `connect()`, so the factory holds that one in-flight promise and every
   * command awaits it; a rejected promise makes commands fail closed.
   */
  ready?: Promise<unknown>;
}

/** Parses a stored record; a malformed or non-record value is treated as absent. */
function parseRecord(raw: string | null): AppSession | undefined {
  if (raw == null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    // A JSON primitive/array is corrupt for our purposes: `get`/`update` must
    // fail closed rather than trust a value that cannot be a session.
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    if (typeof (parsed as AppSession).expiresAt !== 'number') return undefined;
    return parsed as AppSession;
  } catch {
    // Truncated/overwritten value (e.g. a partial write): treat as no session.
    return undefined;
  }
}

export class RedisSessionStore implements SessionStoreApi {
  private readonly now: () => number;
  private readonly ready: Promise<unknown>;

  constructor(
    private readonly client: SessionRedisClient,
    private readonly options: RedisSessionStoreOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.ready = options.ready ?? Promise.resolve();
  }

  /** The store's current time (the injected clock), used for consistent expiry math. */
  nowMs(): number {
    return this.now();
  }

  /** Stores a session, setting its sliding window from now. Throws if unavailable. */
  async create(
    session: Omit<AppSession, 'expiresAt'> & { expiresAt?: number },
  ): Promise<AppSession> {
    const record: AppSession = { ...session, expiresAt: this.now() + this.options.ttlMs };
    try {
      await this.ready;
      await this.client.set(key(record.id), JSON.stringify(record), { EX: this.ttlSeconds() });
    } catch (cause) {
      // Never hand back a record we failed to persist: the caller must abort login.
      throw new SessionStoreUnavailable(cause);
    }
    return record;
  }

  /** Looks up a live session, expiring it and applying sliding renewal. */
  async get(id: string | undefined): Promise<AppSession | undefined> {
    if (!id) return undefined;
    try {
      await this.ready;
      const record = parseRecord(await this.client.get(key(id)));
      if (!record) return undefined;
      if (record.expiresAt <= this.now()) {
        // The stored window lapsed even if the key's TTL had not: fail closed.
        await this.client.del(key(id));
        return undefined;
      }
      // Sliding renewal: extend the persisted window, then the key's own TTL.
      // SET … KEEPTTL leaves the key TTL untouched so the explicit EXPIRE below
      // is the single, observable renewal step (mirrors the in-memory slide).
      record.expiresAt = this.now() + this.options.ttlMs;
      await this.client.set(key(id), JSON.stringify(record), { KEEPTTL: true });
      await this.client.expire(key(id), this.ttlSeconds());
      return record;
    } catch {
      // Redis error → no session (login wall). Never throw past the auth layer.
      return undefined;
    }
  }

  /** Replaces the stored tokens/metadata, preserving the sliding expiry. */
  async update(
    id: string,
    patch: Partial<Omit<AppSession, 'id'>>,
  ): Promise<AppSession | undefined> {
    try {
      await this.ready;
      const record = parseRecord(await this.client.get(key(id)));
      if (!record) return undefined;
      Object.assign(record, patch);
      // Patch in place but keep the expiry (and key TTL) untouched, exactly as
      // the in-memory `Object.assign` does — a refresh must not slide the window.
      await this.client.set(key(id), JSON.stringify(record), { KEEPTTL: true });
      return record;
    } catch {
      return undefined;
    }
  }

  async destroy(id: string | undefined): Promise<void> {
    if (!id) return;
    try {
      await this.ready;
      await this.client.del(key(id));
    } catch {
      // Fail closed: a failed delete is a silent no-op (the session will expire).
    }
  }

  /**
   * Redis EXPIRE is whole seconds; round *up* so a sub-second TTL is never cut
   * short (the stored `expiresAt` remains the authoritative instant either way).
   */
  private ttlSeconds(): number {
    return Math.max(1, Math.ceil(this.options.ttlMs / 1000));
  }
}

function key(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}
