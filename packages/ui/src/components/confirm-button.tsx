// Composed registry `button`, snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import type { MouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './button';

/**
 * How long a form submission may take to be reported before the latch lets go.
 *
 * `useFormStatus` only speaks on a render, so a submission React never reports at all — a
 * click whose default another handler prevented, a form the browser refuses to validate —
 * would hold the latch for good. Past this window the click that armed it is spent and the
 * control re-arms unconditionally: a control that looks dead is the worse bug.
 */
const SUBMIT_START_GRACE_MS = 4000;

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
 * The veto both confirmed paths share: a write already in flight, or a dismissed confirm,
 * stops the click here. What it prevents is the click, never the form's own submit, so a
 * refused second tap cannot start a second submission.
 */
function confirmAllows(event: Preventable, message: string, gate: PendingGate): boolean {
  if (gate.isPending()) {
    event.preventDefault();
    return false;
  }
  if (!window.confirm(message)) {
    event.preventDefault();
    return false;
  }
  return true;
}

/**
 * The confirmed write for a consumer handler: one intent, one write.
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
  if (!confirmAllows(event, message, gate)) return;
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
 * One latch, armed from the click on both paths, because the click is the last moment a
 * second tap can still be refused. A consumer `onClick` is awaited here, so `finally`
 * releases the latch. A form action's promise belongs to React instead: `useFormStatus`
 * reports it a render later, too late for a second tap in the same frame, so the click
 * arms the latch itself and the release waits for that report — a start, then a settle.
 * A start that never comes (a prevented click, a validation stop) releases the latch
 * after `SUBMIT_START_GRACE_MS`.
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
  const submissionReported = useRef(false);
  const releaseTimer = useRef<number | undefined>(undefined);
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

  // The only release for a form action: open the latch once React has reported a
  // submission start and then its settle.
  useEffect(() => {
    if (submitting) {
      submissionReported.current = true;
      window.clearTimeout(releaseTimer.current);
      return;
    }
    if (!submissionReported.current) return;
    submissionReported.current = false;
    gate.setPending(false);
  }, [submitting, gate]);

  // A pending grace window belongs to this control; it must not outlive it.
  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);

  function armSubmitLatch() {
    gate.setPending(true);
    releaseTimer.current = window.setTimeout(() => gate.setPending(false), SUBMIT_START_GRACE_MS);
  }

  function confirmThenSubmit(event: MouseEvent<HTMLButtonElement>) {
    if (!confirmAllows(event, message, gate)) return;
    // Outside a form there is no submission for `useFormStatus` to report, so arming
    // would only leave the control looking dead; such a button submits nothing anyway.
    if (!event.currentTarget.form) return;
    armSubmitLatch();
  }

  function confirmThenClick(event: MouseEvent<HTMLButtonElement>) {
    void runConfirmed(event, message, onClick as ((event: never) => unknown) | undefined, gate);
  }

  return (
    <Button
      type="submit"
      onClick={onClick ? confirmThenClick : confirmThenSubmit}
      disabled={disabled || pending || submitting}
      {...rest}
    >
      {children}
    </Button>
  );
}
