'use client';

import { useEffect, useRef } from 'react';

/** One owner for the toggle-settle window shared by every debounced toggle. */
export const TOGGLE_DEBOUNCE_MS = 500;

/**
 * Trailing debounce for a server write: each call replaces the pending action and
 * restarts the timer, so a burst of toggles coalesces into one call after `delayMs`
 * of quiet. On unmount a still-pending action is flushed, not dropped, so a write
 * is never lost when the control navigates away mid-burst.
 */
export function useDebouncedCallback(delayMs = TOGGLE_DEBOUNCE_MS): (fn: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      const action = pending.current;
      timer.current = null;
      pending.current = null;
      action?.();
    },
    [],
  );

  return (fn: () => void) => {
    pending.current = fn;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const action = pending.current;
      pending.current = null;
      action?.();
    }, delayMs);
  };
}
