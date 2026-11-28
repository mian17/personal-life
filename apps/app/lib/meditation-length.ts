/**
 * The length the sitter last started, remembered in this browser (`SPEC-meditation-app` §1).
 *
 * A per-device preference belongs to the device: the settings row holds the plan a first visit
 * opens on, and this holds what this browser last chose. Every touch of storage is guarded —
 * private mode and a full quota throw, and neither may break the page or a running sitting.
 */

export const MEDITATION_LENGTH_KEY = 'life.meditation.minutes';

/**
 * The sitting length's own range: single-minute steps over a minute to a day. The service stores
 * a length range-only, so there is no grid to land on and every step from the default is legal.
 */
export const MEDITATION_LENGTH_STEP = { floor: 1, ceiling: 1440, step: 1 } as const;

/**
 * The remembered length, or `null` when this browser has nothing usable stored. Nothing is
 * clamped here: the stepper's own range is the caller's, and it applies it.
 */
export function readStoredLength(): number | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(MEDITATION_LENGTH_KEY);
    if (stored === null) return null;

    const minutes = Number(stored);
    return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
  } catch {
    return null;
  }
}

/** Remember the length this browser starts next time; a browser that refuses simply forgets. */
export function storeLength(minutes: number): void {
  try {
    window.localStorage.setItem(MEDITATION_LENGTH_KEY, String(minutes));
  } catch {
    // Private mode or a full quota: the sitting is unaffected, and the next visit opens on the plan.
  }
}
