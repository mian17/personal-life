'use server';

import { setPrefNumbers } from '@life/app-kit/preference-action';
import { clampMinutes } from '@life/pomodoro';


/** The three form fields and the cookie each one persists. */
const DURATION_FIELDS = [
  { field: 'focus', pref: 'pomodoro_focus' },
  { field: 'short', pref: 'pomodoro_short' },
  { field: 'long', pref: 'pomodoro_long' },
] as const;

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
