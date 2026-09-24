import 'server-only';

/**
 * Server-side app session store. Holds OIDC tokens, so this module is
 * `server-only` — nothing here may ever reach a client component.
 *
 * Storage is an in-process Map. That is honest for this single-instance,
 * single-user app: an app restart drops all sessions and everyone re-logs-in.
 * If the app is ever scaled horizontally, replace this with a shared store
 * behind the same interface; no caller needs to change.
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

export class SessionStore {
  private readonly sessions = new Map<string, AppSession>();

  constructor(
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly now: Clock = Date.now,
  ) {}

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
