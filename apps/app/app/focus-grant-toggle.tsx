'use client';

import { useState } from 'react';
import { Button, StatusText } from '@life/ui';
import { grantFocusReadAction } from '@/app/pomodoro/actions';
import type { GrantState } from '@/lib/focus-api';

/**
 * Focus → todos: the one-way "Allow" for the read grant (`SPEC-todo-origin`
 * assumption 12).
 *
 * **Deliberately not a `Switch`.** A switch has an off position, and there is no off
 * operation here: todo-service exposes no DELETE for a grant, so a switch that moved
 * back would report a revocation that never happened. So the row is an action while
 * the grant is absent and a read-out once it exists — the two states the service can
 * actually reach, drawn as the two different things they are.
 *
 * The state is **read from the server** (`readGrantState`) rather than assumed, so a
 * reload after granting shows the read-out. `'unknown'` is the third branch and says
 * so: a check that could not run is not the same fact as never having allowed it, and
 * offering Allow after a failed check would invite a press that may already be
 * redundant.
 *
 * `busy` disables the button for the flight so a second press cannot race the first;
 * `error` is one line the row renders, the `MealTodoSwitch` failure contract.
 */
export function FocusGrantToggle({ state }: Readonly<{ state: GrantState }>) {
  const [granting, setGranting] = useState(false);
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow(): Promise<void> {
    setGranting(true);
    setError(null);
    const result = await grantFocusReadAction();
    setGranting(false);
    if (result.ok) {
      // Local on success, so the press pays off immediately; the server read is what
      // the next load renders, so this is a shortcut and not a second source of truth.
      setGranted(true);
      return;
    }
    setError(result.message);
  }

  if (state === 'granted' || granted) {
    return (
      <StatusText>
        {`Allowed. Focus can read your open todos — this cannot be switched off.`}
      </StatusText>
    );
  }

  if (state === 'unknown') {
    return (
      <StatusText>{`Couldn't check whether todo access is allowed. Reload to try again.`}</StatusText>
    );
  }

  return (
    <>
      <Button type="button" size="bare" disabled={granting} onClick={() => void allow()}>
        Allow
      </Button>
      {error !== null && <StatusText className="text-danger!">{error}</StatusText>}
    </>
  );
}
