/**
 * The refreshing token read (SPEC-ops-agent-contract §3.5): the default `readToken`
 * for both adapters — MCP and CLI wire this same function. A stored token still outside the skew window is handed
 * over untouched; one inside it is rotated once through `refresh()`, which
 * persists the rotated pair itself — this module never writes the store.
 *
 * Every failure reads as `undefined`, so the canonical `run \`npm run ops -- login\``
 * hint surfaces: a stale token is worth no retry, and the fix is the same.
 */
import { refresh } from './refresh';
import { readTokens, type StoredTokens } from './token-store';

const DEFAULT_REFRESH_SKEW_MS = 60_000;

/** The rotation in flight, shared by every concurrent reader; cleared when it settles. */
let inFlightRotation: Promise<string | undefined> | undefined;

/** The access token to send now: the stored one, or a rotation's when it is near expiry. */
export async function currentAccessToken(): Promise<string | undefined> {
  const stored = await readTokens();
  if (stored === undefined) return undefined;
  if (!expiresSoon(stored, resolveRefreshSkewMs(process.env))) return stored.accessToken;
  return await rotateAccessToken();
}

/** `LIFE_OPS_REFRESH_SKEW_MS` sets the window; `0` disables it, a broken value falls back. */
export function resolveRefreshSkewMs(env: NodeJS.ProcessEnv): number {
  const configured = env.LIFE_OPS_REFRESH_SKEW_MS?.trim();
  if (configured === undefined || configured === '') return DEFAULT_REFRESH_SKEW_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_REFRESH_SKEW_MS;
  return parsed;
}

function expiresSoon(stored: StoredTokens, skewMs: number): boolean {
  return skewMs > 0 && stored.expiresAt - Date.now() <= skewMs;
}

/** One rotation however many readers ask: the first starts it, the rest join it. */
function rotateAccessToken(): Promise<string | undefined> {
  inFlightRotation ??= rotateAndForgetFailure().finally(clearRotation);
  return inFlightRotation;
}

function clearRotation(): void {
  inFlightRotation = undefined;
}

async function rotateAndForgetFailure(): Promise<string | undefined> {
  try {
    return (await refresh())?.accessToken;
  } catch {
    return undefined;
  }
}
