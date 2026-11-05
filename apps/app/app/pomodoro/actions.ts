'use server';

import { redirect } from 'next/navigation';
import { setPrefNumbers } from '@life/app-kit/preference-action';
import { clampMinutes, isDailyGoal } from '@life/pomodoro';
import { recordSession, setGoal } from '@/lib/focus-api';
import { getToday } from '@/lib/today';

/** The three form fields and the cookie each one persists. */
const DURATION_FIELDS = [
  { field: 'focus', pref: 'pomodoro_focus' },
  { field: 'short', pref: 'pomodoro_short' },
  { field: 'long', pref: 'pomodoro_long' },
] as const;

/** Where a refused daily goal sends the owner back: this app's settings form, flagged. */
const GOAL_REJECTED_HREF = '/pomodoro/settings?goal=rejected';

/**
 * Persist the three duration preferences, so a reload starts the timer from the
 * minutes the owner edited (SPEC-pomodoro §4, State storage).
 */
export async function setPomodoroDurations(formData: FormData): Promise<void> {
  // One batch write, not one round trip per field: the three cookies are
  // independent, so awaiting inside the loop only cost two extra cookie-store
  // reads and two extra revalidations.
  await setPrefNumbers(
    DURATION_FIELDS.map(
      ({ field, pref }) => [pref, clampMinutes(Number(formData.get(field)))] as const,
    ),
  );
}

/**
 * Set today's goal (`PUT /api/goal`). The day is the shared `getToday()` owner,
 * so only today re-measures: a past day keeps the goal its own dated row gave it
 * (`SPEC-focus-service` §1).
 *
 * A daily goal is a day's total focus, so a mistyped one is refused and the owner is sent
 * back to the form — never replaced by a number they did not choose (`clampMinutes` would
 * put one block's 25 minutes in its place).
 */
export async function setPomodoroGoal(formData: FormData): Promise<void> {
  const minutes = Number(formData.get('goal'));

  if (!isDailyGoal(minutes)) redirect(GOAL_REJECTED_HREF);
  else await setGoal(await getToday(), minutes);
}

/**
 * Keep one finished focus block in the owner's day (`POST /api/sessions`). The
 * day is resolved here by the shared `getToday()` owner, never by the browser
 * clock (lesson 0019), and a part-minute block is a block the day does not hold.
 */
export async function recordFocusSession(minutes: number): Promise<void> {
  if (minutes < 1) return;

  await recordSession(await getToday(), minutes);
}
