'use server';

import { setPrefNumber } from '@life/app-kit';
import type { Durations } from '@life/pomodoro';

/**
 * Persist the three duration preferences, so a reload starts the timer from the
 * minutes the owner edited (SPEC-pomodoro §4, State storage).
 */
export async function setPomodoroDurations(durations: Durations): Promise<void> {
  await setPrefNumber('pomodoro_focus', durations.focus);
  await setPrefNumber('pomodoro_short', durations.short);
  await setPrefNumber('pomodoro_long', durations.long);
}
