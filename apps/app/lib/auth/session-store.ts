import 'server-only';

/**
 * Server-side app session store. Holds OIDC tokens, so this module is
 * `server-only` — nothing here may ever reach a client component.
 *
 * Storage is an in-process Map anchored on `globalThis` (see below). That is
 * honest for this single-instance, single-user app: an app restart drops all
 * sessions and everyone re-logs-in. If the app is ever scaled horizontally,
 * replace this with a shared store behind the same interface; no caller changes.
 */

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

export class SessionStore {
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

/** Process-wide store. A restart clears it (documented above). */
export const sessionStore = new SessionStore();
