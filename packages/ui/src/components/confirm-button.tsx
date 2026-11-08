// Composed registry `button`, snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import type { MouseEvent, ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './button';

/**
 * The confirm is the only way through: a dismissal fires neither the form
 * submit nor the consumer's `onClick`.
 */
export interface ConfirmButtonProps extends Omit<ButtonProps, 'type'> {
  message: string;
  children: ReactNode;
}

/** The one thing the guard needs from an event: the veto. */
export interface Preventable {
  preventDefault(): void;
}

/**
 * The write state the guard reads and writes. Injectable so the flow below is a plain
 * function — the component backs it with a ref plus state, a caller can back it with
 * anything, and a test can drive it without a renderer.
 */
export interface PendingGate {
  isPending(): boolean;
  setPending(pending: boolean): void;
}

/**
 * The confirmed write: one intent, one write.
 *
 * `disabled` alone is not a guard. It lands on the render after the click, so two taps in
 * the same frame both reach this function; the synchronous `isPending` check is what
 * actually refuses the second write, and it re-arms only in `finally`, so a failed write
 * cannot leave the control dead. The rejection is never swallowed — the caller's error
 * path stays exactly as it was, because the second tap resolving to `undefined` already
 * says "the write did not happen twice" without inventing an error.
 */
export async function runConfirmed(
  event: Preventable,
  message: string,
  onClick: ((event: never) => unknown) | undefined,
  gate: PendingGate,
): Promise<void> {
  if (gate.isPending()) {
    event.preventDefault();
    return;
  }
  if (!window.confirm(message)) {
    event.preventDefault();
    return;
  }
  // No consumer handler: the default submit proceeds and React tracks its action.
  if (!onClick) return;
  gate.setPending(true);
  try {
    await onClick(event as never);
  } finally {
    gate.setPending(false);
  }
}

/**
 * A destructive action that asks first and writes once.
 *
 * Two pending sources, because a form action is a promise React owns rather than one we
 * can await: a consumer `onClick` is guarded and awaited here, and a form action is
 * reported by `useFormStatus` (false anywhere the button is outside a form).
 *
 * The guard is local rather than `usePendingAction` from `@life/app-kit`: that package
 * depends on `@life/ui`, so importing back would close a dependency cycle.
 */
export function ConfirmButton({
  message,
  onClick,
  disabled,
  children,
  ...rest
}: Readonly<ConfirmButtonProps>) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const { pending: submitting } = useFormStatus();
  const gate = useMemo<PendingGate>(
    () => ({
      isPending: () => inFlight.current,
      setPending: (next) => {
        inFlight.current = next;
        setPending(next);
      },
    }),
    [],
  );

  function confirmThenClick(event: MouseEvent<HTMLButtonElement>) {
    void runConfirmed(event, message, onClick as ((event: never) => unknown) | undefined, gate);
  }

  return (
    <Button
      type="submit"
      onClick={confirmThenClick}
      disabled={disabled || pending || submitting}
      {...rest}
    >
      {children}
    </Button>
  );
}
