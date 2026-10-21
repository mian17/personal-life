'use server';

import { setPrefNumber } from '@life/app-kit';
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
  for (const { field, pref } of DURATION_FIELDS) {
    await setPrefNumber(pref, clampMinutes(Number(formData.get(field))));
  }
}
