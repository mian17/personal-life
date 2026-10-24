import 'server-only';
import { randomBytes } from 'crypto';
import { createClient } from 'redis';
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

/** Hard ceiling on how long the cold-connect attempt may run before we stop awaiting it. */
export const REDIS_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Hard ceiling on the reconnect backoff — the same 2 s cap node-redis's own
 * `defaultReconnectStrategy` uses, so a long outage never stretches the retry
 * interval without bound.
 */
export const REDIS_RECONNECT_MAX_DELAY_MS = 2_000;

/**
 * The reconnect strategy the auth clients install: exponential backoff (capped at
 * `REDIS_RECONNECT_MAX_DELAY_MS`, plus the 0–200 ms jitter node-redis adds) that
 * **never** returns `false`.
 *
 * Never giving up is the fix for the permanent-outage regression. A strategy that
 * returns `false` makes node-redis latch `#isOpen = false` and stop reconnecting
 * for the life of the process; because the stores are built once at module init
 * and nothing re-calls `connect()`, a transient Redis blip would brick the
 * replica forever (permanent login wall, the refresh lock silently degraded with
 * no signal). Retrying forever keeps background recovery alive. The fail-closed,
 * non-hanging behavior *during* an outage comes from `disableOfflineQueue` +
 * `connectBounded`, not from giving up: while the socket is not ready every
 * command rejects fast instead of hanging.
 */
export function unboundedReconnectStrategy(retries: number): number {
  // Jitter only needs to decorrelate replicas; crypto is used so the value never
  // comes from the PRNG (a reconnect delay is not a security boundary, but it is
  // no worse here and keeps one source of randomness in the auth path).
  const jitter = randomBytes(1)[0] % 200;
  return Math.min(2 ** retries * 50, REDIS_RECONNECT_MAX_DELAY_MS) + jitter;
}

/**
 * The fail-closed client construction shared by the session store and the refresh
 * lock. Both need the same shape so an unreachable Redis can never make
 * `get`/`update`/`create`/`acquire` hang:
 * - `disableOfflineQueue` makes commands issued before ready reject immediately
 *   (`ClientOfflineError`) — the in-repo precedent is the idp/note caches;
 * - `unboundedReconnectStrategy` keeps node-redis's default retry-forever
 *   background recovery (so a replica heals when Redis returns) while capping the
 *   backoff; commands still fail fast while offline because of the offline-queue
 *   setting above;
 * - `connectBounded` races the *cold* `connect()` against a hard timeout and
 *   swallows the outcome into a promise that ALWAYS settles — it can never become
 *   an unhandled rejection, and an injected `connect()` whose promise never
 *   settles (a hung socket) still resolves to `undefined` within the bound. The
 *   race only bounds our *initial wait*: node-redis keeps reconnecting in the
 *   background regardless, so recovery is not tied to this promise.
 *
 * The returned `ready` never rejects: callers `await this.ready` and then issue
 * the command, which either succeeds or fails fast into their own mapping.
 */
export function connectBounded(client: {
  connect(): Promise<unknown>;
}): { ready: Promise<void> } {
  const connecting = client.connect().then(
    () => undefined,
    () => undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REDIS_CONNECT_TIMEOUT_MS);
    // Do not hold the event loop open just for the connect watchdog.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  const ready = Promise.race([connecting, timeout]).finally(() => clearTimeout(timer));
  return { ready };
}

/**
 * Builds the one fail-closed client both auth factories use. `error` events are
 * sunk (an unhandled `'error'` would crash the process, and the URL may carry
 * credentials so we never log it). `socket.reconnectStrategy` is pinned to
 * `unboundedReconnectStrategy` — never a give-up strategy — so a transient outage
 * is always recoverable without a process restart.
 */
export function createBoundedRedisClient(url: string): {
  client: ReturnType<typeof createClient>;
  ready: Promise<void>;
} {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { reconnectStrategy: unboundedReconnectStrategy },
  });
  client.on('error', () => {});
  const { ready } = connectBounded(client);
  return { client, ready };
}

/** Record key prefix: JSON of an `AppSession` at `app:sess:<id>`. */
export const SESSION_KEY_PREFIX = 'app:sess:';

export interface RedisSessionStoreOptions {
  /** Sliding window, in ms (the same TTL the in-memory store uses). */
  ttlMs: number;
  /** Injected clock, matching the in-memory store, for deterministic expiry math. */
  now?: () => number;
  /**
   * Resolves once the client is connected OR the cold-connect watchdog has
   * elapsed (see `connectBounded`) — whichever comes first. node-redis opens no
   * socket until `connect()`, so the factory holds that one in-flight promise and
   * every command awaits it; because it always settles, a command either succeeds
   * or fails fast into the fail-closed mapping rather than hanging. The bound is
   * only on our wait: node-redis keeps reconnecting in the background.
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
  private readyPromise: Promise<unknown> | undefined;

  constructor(
    private readonly client: SessionRedisClient,
    private readonly options: RedisSessionStoreOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * The connect promise, created on first use rather than in the constructor:
   * `create`/`get`/`update`/`destroy` each await it, and `??=` keeps it a
   * single promise for the instance's life (so a hung connect is awaited once).
   */
  private get ready(): Promise<unknown> {
    return (this.readyPromise ??= this.options.ready ?? Promise.resolve());
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
