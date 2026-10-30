/**
 * The refreshing token read (SPEC-ops-agent-contract §3.5): the default `readToken`
 * for both adapters — MCP and CLI wire this same function. A stored token still outside the skew window is handed
 * over untouched; one inside it is rotated once through `refresh()`, which
 * persists the rotated pair itself — this module never writes the store.
 *
 * A store that is absent reads as `undefined`, so the canonical `run \`npm run ops -- login\``
 * hint surfaces. A store that is present but holds a dead credential raises
 * `RefreshRejected` instead: rotation was needed and could not deliver, which is a
 * different fix from logging in, and the executor names the operation it happened on.
 */
import { RefreshRejected, REFRESH_REJECTED_DETAIL } from '../transport/errors';
import { refresh } from './refresh';
import { readTokens, type StoredTokens } from './token-store';

const DEFAULT_REFRESH_SKEW_MS = 60_000;

/** The rotation in flight, shared by every concurrent reader; cleared when it settles. */
let inFlightRotation: Promise<string> | undefined;

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
function rotateAccessToken(): Promise<string> {
  inFlightRotation ??= rotateOrRaise().finally(clearRotation);
  return inFlightRotation;
}

function clearRotation(): void {
  inFlightRotation = undefined;
}

/** A rotation that yields no pair leaves the credential dead, so it raises rather than answers. */
async function rotateOrRaise(): Promise<string> {
  const rotated = await attemptRefresh();
  if (rotated === undefined) throw new RefreshRejected(REFRESH_REJECTED_DETAIL);
  return rotated.accessToken;
}

/** `refresh` answers `undefined` when login is required and throws when the IdP is unreachable; both are one dead credential here. */
async function attemptRefresh(): Promise<StoredTokens | undefined> {
  try {
    return await refresh();
  } catch {
    return undefined;
  }
}
