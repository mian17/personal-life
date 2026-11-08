import { createClient } from 'redis';
import { spawnService, waitForHttp, type SpawnedService } from './services';
import { E2E_APP_SECRET, E2E_OWNER, hopPorts, repoRoot, testPorts } from './config';
import { heldSlot } from './teardown';

/**
 * Two real app replicas for the Redis hop proof (Task 3 of the Redis chapter).
 *
 * The whole point of `RedisSessionStore` is that replicas behave like one
 * service: a session created on instance A must be honored by instance B with no
 * shared process memory. This boots both from the same production standalone
 * artifact Docker runs (`degraded-app.ts` pattern), pointing at:
 *
 *   - ONE Redis, handed in by the caller: `TEST_REDIS_URL` when the operator
 *     pinned one, else the held slot's booted `redis-e2e-<slot>`,
 *   - ONE IdP (the harness's, whose callback registry is extended in `stack.ts`),
 *   - ONE note-service (the harness's), so the browser proof exercises the real
 *     authenticated Notes UI rather than a synthetic endpoint.
 *
 * Nothing here touches the human's deployed stack or dev processes, and the
 * replicas' Redis endpoint arrives as an argument (`startHopApps`) rather than
 * being read from the environment here: the spec owns the one source of truth.
 */

export interface HopInstance {
  /** `app-a` / `app-b`, for log labels. */
  name: string;
  /** Browser origin (`http://localhost:<port>`). */
  origin: string;
  service: SpawnedService;
}

export interface HopApps {
  a: HopInstance;
  b: HopInstance;
  /** Stops both instances (each in its own process group). */
  stop: () => Promise<void>;
}

/** Per-instance env: same Redis + IdP + note-service, distinct port/origin. */
function hopAppEnv(port: number, redisUrl: string): NodeJS.ProcessEnv {
  const { idpPort, notePort } = testPorts(heldSlot());
  const origin = `http://localhost:${port}`;
  return {
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    // The one shared store — this is what makes A and B one service.
    REDIS_URL: redisUrl,
    // The harness's already-running note-service and IdP (both private ports).
    API_URL: `http://127.0.0.1:${notePort}`,
    IDP_ISSUER: `http://127.0.0.1:${idpPort}`,
    OIDC_APP_CLIENT_ID: 'app',
    OIDC_APP_CLIENT_SECRET: E2E_APP_SECRET,
    // Registered on the shared IdP by `stack.ts` (hopRedirectUris).
    OIDC_APP_REDIRECT_URI: `${origin}/auth/callback`,
    // Production keeps the access gate active; the browser carries the owner header.
    OWNER_LOGIN: E2E_OWNER,
  };
}

/**
 * Boots app-A and app-B from the built standalone artifact. Reuses the artifact
 * `global-setup.ts` already built (and whose static assets it copied in), so this
 * adds no build cost. Resolves once both answer on `/` (a sub-500
 * redirect/forbidden with no session, exactly as `degraded-app.ts` waits).
 */
export async function startHopApps(redisUrl: string): Promise<HopApps> {
  const { appAPort, appBPort } = hopPorts(heldSlot());

  const serviceA = await spawnService({
    name: 'app-a',
    command: 'node',
    args: ['.next/standalone/apps/app/server.js'],
    cwd: `${repoRoot()}/apps/app`,
    env: hopAppEnv(appAPort, redisUrl),
  });
  const serviceB = await spawnService({
    name: 'app-b',
    command: 'node',
    args: ['.next/standalone/apps/app/server.js'],
    cwd: `${repoRoot()}/apps/app`,
    env: hopAppEnv(appBPort, redisUrl),
  });

  const a: HopInstance = { name: 'app-a', origin: `http://localhost:${appAPort}`, service: serviceA };
  const b: HopInstance = { name: 'app-b', origin: `http://localhost:${appBPort}`, service: serviceB };

  await Promise.all([waitForHttp(`${a.origin}/`, 60_000), waitForHttp(`${b.origin}/`, 60_000)]);

  return {
    a,
    b,
    stop: async () => {
      await Promise.all([serviceA.stop(), serviceB.stop()]);
    },
  };
}

/**
 * The session record as the app stores it: JSON at `app:sess:<id>`. Only the
 * fields the hop proof observes are declared.
 */
export interface AppSessionRecord {
  id: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  expiresAt: number;
}

/** Redis key prefix, mirrored from `lib/auth/redis-store.ts` (read-only reference). */
export function sessionKey(sessionId: string): string {
  return `app:sess:${sessionId}`;
}

/**
 * Opens a raw client on the test Redis so the spec can observe and (only in the
 * test-owned endpoint) tamper the shared record. An `error` listener is
 * mandatory — Node treats an unhandled client error as a crash.
 */
export async function openTestRedis(
  url: string,
): Promise<ReturnType<typeof createClient>> {
  const client = createClient({ url });
  client.on('error', () => {});
  await client.connect();
  return client;
}

export type TestRedis = Awaited<ReturnType<typeof openTestRedis>>;

/** Reads and parses the shared session record, or `undefined` if absent/corrupt. */
export async function readSessionRecord(
  client: TestRedis,
  sessionId: string,
): Promise<AppSessionRecord | undefined> {
  const raw = await client.get(sessionKey(sessionId));
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as AppSessionRecord;
  } catch {
    return undefined;
  }
}

/**
 * The near-expiry lever. The IdP's access-token TTL is a hardcoded 600s constant
 * (`apps/idp/src/oidc/access-token.policy.ts`) with no env override, so the
 * harness cannot mint a short-lived token. Instead we rewrite the *shared*
 * record's `accessTokenExpiresAt` to land inside `REFRESH_SKEW_MS` (30s) while
 * keeping every other field — the same state a token about to expire would have.
 * `KEEPTTL` preserves the 7-day sliding window. Test-owned endpoint only.
 */
export async function forceNearExpiry(
  client: TestRedis,
  sessionId: string,
  expiresAtMs: number,
): Promise<void> {
  const record = await readSessionRecord(client, sessionId);
  if (!record) throw new Error(`session ${sessionId} not found in test Redis`);
  record.accessTokenExpiresAt = expiresAtMs;
  await client.set(sessionKey(sessionId), JSON.stringify(record), { expiration: 'KEEPTTL' });
}

/** Best-effort close so the Playwright worker can exit cleanly. */
export async function closeTestRedis(client: TestRedis): Promise<void> {
  try {
    await client.quit();
  } catch {
    // Already gone; nothing to reap.
  }
}
