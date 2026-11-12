'use client';

import { useState } from 'react';
import { StatusText, Switch } from '@life/ui';
import { setMealTodosAction } from '@/app/meal-todo-actions';

/**
 * The meals → todos opt-in switch (`SPEC-todo-origin` assumption 12).
 *
 * Seeds from the server-read state and is optimistic: the switch moves on the press
 * and moves back when the write fails, with the reason in the row's `StatusText` — a
 * control that waits for a round trip before showing what the user just did reads as
 * broken, and one that stays moved after a failure lies.
 *
 * `busy` disables the control for the duration so a second press cannot race the
 * first; the store is one row per owner, so the last write wins and two in flight
 * would leave the screen disagreeing with the database.
 */
export function MealTodoSwitch({ enabled }: Readonly<{ enabled: boolean }>) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setOn(next);
    const result = await setMealTodosAction(next);
    setBusy(false);
    if (!result.ok) {
      // Revert to the state the server still holds, not to the pre-press value:
      // another tab may have moved it, and the server is the one that knows.
      setOn(!next);
      setError(result.message);
    }
  }

  return (
    <>
      <Switch
        label="Create daily meal tasks"
        checked={on}
        disabled={busy}
        onCheckedChange={(next) => void toggle(next)}
      />
      {error !== null && <StatusText>{error}</StatusText>}
    </>
  );
}
