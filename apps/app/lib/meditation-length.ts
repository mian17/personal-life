/**
 * The length this browser last chose for a sitting (`SPEC-meditation-app` §1): the cookie that
 * carries it back to the server, the step it moves by, and the browser's own write.
 *
 * A per-device preference belongs to the device, and it has to be known before the first render:
 * the settings row holds the plan a first visit opens on, a cookie holds what this browser last
 * chose, so the server seeds the stepper with it instead of a reload correcting itself after
 * paint. This module holds no request read, because the idle screen is a client component and
 * imports it: the route reads the cookie, and only the browser writes it, here.
 */

/** Cookie carrying this browser's last choice; written below, read by the meditation page. */
export const MEDITATION_LENGTH_KEY = 'life.meditation.minutes';

/**
 * The sitting length's own range: single-minute steps over a minute to a day. The service stores
 * a length range-only, so there is no grid to land on and every step from the default is legal.
 */
export const MEDITATION_LENGTH_STEP = { floor: 1, ceiling: 1440, step: 1 } as const;

/** A year, the lifetime the timezone cookie already uses. */
const COOKIE_MAX_AGE_SECONDS = 31_536_000;

/**
 * The length a cookie value names, or `null` when it names nothing usable. Nothing is clamped
 * here: the stepper's own range is the caller's, and it applies it.
 */
export function parseStoredLength(raw: string | null): number | null {
  if (raw === null) return null;

  const minutes = Number(raw);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/** Remember the length this browser starts next time; a browser that refuses simply forgets. */
export function storeLength(minutes: number): void {
  try {
    document.cookie = `${MEDITATION_LENGTH_KEY}=${minutes};path=/;max-age=${COOKIE_MAX_AGE_SECONDS};samesite=lax`;
  } catch {
    // Cookies refused: the sitting is unaffected, and the next visit opens on the plan.
  }
}
