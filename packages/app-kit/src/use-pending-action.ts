'use client';

import { useCallback, useRef, useState } from 'react';

export type PendingAction = (action: () => Promise<unknown>) => Promise<void>;

/**
 * Guards a write so one intent costs one write.
 *
 * A disabled button is not a guard: it re-arms the instant the request settles, and the
 * render that would disable it is asynchronous, so a double tap can queue two writes
 * before the first one's `pending` has landed. The ref is written synchronously inside the
 * call, which is what actually refuses the second write; `pending` exists only to render
 * the disabled state.
 *
 * The flag clears in `finally`, so a failed write cannot leave the control dead — the
 * caller's rejection path is unchanged (the error is re-thrown, never swallowed).
 * A settled `run` is not an unmount concern: React 19 makes a `setState` after unmount a
 * silent no-op, so no mounted ref is needed.
 */
export function usePendingAction(): [pending: boolean, run: PendingAction] {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback<PendingAction>(async (action) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return [pending, run];
}
