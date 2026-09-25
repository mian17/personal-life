import 'server-only';
import { RedisSessionStore, createBoundedRedisClient } from './redis-store';

/**
 * Server-side app session store. Holds OIDC tokens, so this module is
 * `server-only` — nothing here may ever reach a client component.
 *
 * Storage is an in-process Map by default (anchored on `globalThis`, see below).
 * That is honest for a single-instance app: an app restart drops all sessions and
 * everyone re-logs-in. When `REDIS_URL` is set the shared `RedisSessionStore`
 * replaces it behind the same interface (see `createSessionStore`), so replicas
 * behave as one service.
 */

/**
 * A store method may be synchronous (in-process Map) or asynchronous (Redis).
 * The seam is written this way so both implementations share one interface
 * without the in-process fast path paying for a promise it never uses.
 */
export type MaybePromise<T> = T | Promise<T>;

export interface AppSession {
  /** Opaque session id (the cookie value); never derived from tokens. */
  id: string;
  /** IdP subject (`sub`) — the user's identity. */
  subject: string;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  /** Access-token expiry, epoch ms. */
  accessTokenExpiresAt: number;
  /** Session expiry, epoch ms (sliding). */
  expiresAt: number;
}

/** 7-day sliding session (recorded decision). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Refresh when the access token is within this window of expiring. */
export const REFRESH_SKEW_MS = 30 * 1000;

type Clock = () => number;

/**
 * Next.js runs middleware and route handlers in separate module registries, so a
 * plain module-level `new Map()` would give them different stores. They DO share
 * one process (and `globalThis`), so the backing map is anchored there. This is
 * also what makes the session created by the callback route visible to the
 * middleware that gates the next request.
 */
const GLOBAL_STORAGE_KEY = '__lifeAppSessionStore';

export function defaultSessionStorage(): Map<string, AppSession> {
  const holder = globalThis as unknown as Record<string, Map<string, AppSession> | undefined>;
  holder[GLOBAL_STORAGE_KEY] ??= new Map<string, AppSession>();
  return holder[GLOBAL_STORAGE_KEY]!;
}

/**
 * The store seam: the exact surface callers depend on, satisfied by both the
 * in-memory store (dev/e2e) and `RedisSessionStore` (shared, `REDIS_URL` set).
 *
 * `size`/`clear` are test/debug aids and therefore optional — Redis cannot
 * enumerate its keys with the command surface this module uses (no `SCAN` by
 * design; the app only ever addresses sessions by id).
 */
export interface SessionStoreApi {
  /** The store's current time (the injected clock), used for consistent expiry math. */
  nowMs(): MaybePromise<number>;
  /** Stores a session, setting its sliding window from now. */
  create(
    session: Omit<AppSession, 'expiresAt'> & { expiresAt?: number },
  ): MaybePromise<AppSession>;
  /** Looks up a live session, expiring it and applying sliding renewal. */
  get(id: string | undefined): MaybePromise<AppSession | undefined>;
  /** Replaces the stored tokens/metadata for an existing session. */
  update(id: string, patch: Partial<Omit<AppSession, 'id'>>): MaybePromise<AppSession | undefined>;
  destroy(id: string | undefined): MaybePromise<void>;
  /** Test/debug aid. */
  size?(): MaybePromise<number>;
  /** Test/debug aid: drop every session. */
  clear?(): MaybePromise<void>;
}

export class SessionStore implements SessionStoreApi {
  private readonly sessions: Map<string, AppSession>;

  constructor(
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly now: Clock = Date.now,
    storage: Map<string, AppSession> = defaultSessionStorage(),
  ) {
    this.sessions = storage;
  }

  /** The store's current time (the injected clock), used for consistent expiry math. */
  nowMs(): number {
    return this.now();
  }

  /** Stores a session, setting its sliding window from now. */
  create(
    session: Omit<AppSession, 'expiresAt'> & { expiresAt?: number },
  ): AppSession {
    const record: AppSession = { ...session, expiresAt: this.now() + this.ttlMs };
    this.sessions.set(record.id, record);
    return record;
  }

  /** Looks up a live session, expiring it and applying sliding renewal. */
  get(id: string | undefined): AppSession | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    // Sliding renewal: each successful lookup extends the window.
    session.expiresAt = this.now() + this.ttlMs;
    return session;
  }

  /** Replaces the stored tokens/metadata for an existing session. */
  update(id: string, patch: Partial<Omit<AppSession, 'id'>>): AppSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    Object.assign(session, patch);
    return session;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  /** Test/debug aid. */
  size(): number {
    return this.sessions.size;
  }

  /** Test/debug aid: drop every session. */
  clear(): void {
    this.sessions.clear();
  }
}

/**
 * Selects the store implementation once at module init: `REDIS_URL` set → the
 * shared `RedisSessionStore` (replicas behave as one service); unset → the
 * in-process store, so dev/e2e stay Redis-free and behavior is unchanged.
 *
 * The client is built with `createBoundedRedisClient`: node-redis's default
 * offline queue would make every command issued during an outage await a
 * `connect()` that never settles, so requests HANG instead of failing closed.
 * The client disables the offline queue (commands reject fast) and races the cold
 * connect against a hard timeout, while its reconnect strategy retries forever so
 * the replica heals on its own once Redis returns. `ready` always settles, so
 * commands reject fast into the store's fail-closed mapping (`get` → undefined,
 * `create` → throw) and recovery needs no process restart.
 */
export function createSessionStore(): SessionStoreApi {
  const url = process.env.REDIS_URL;
  if (!url) return new SessionStore();
  const { client, ready } = createBoundedRedisClient(url);
  return new RedisSessionStore(client, { ttlMs: SESSION_TTL_MS, ready });
}

/**
 * Process-wide store, selected once at module init by `createSessionStore()`. An
 * app restart clears the in-memory variant (documented above); with `REDIS_URL`
 * set the session lives in Redis, shared across replicas and surviving restarts.
 *
 * ⚠️ The seam is `MaybePromise`: with a Redis store every `get` is a Promise.
 * Callers MUST `await` it — `Boolean(sessionStore.get(...))` on a pending Promise
 * is always true and would let every unauthenticated request through the
 * middleware identity gate. `middleware.test.ts` pins both directions.
 */
export const sessionStore: SessionStoreApi = createSessionStore();
