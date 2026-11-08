'use client';

import { PomodoroPage, type Durations } from '@life/pomodoro';
import { recordFocusSession, setPomodoroBreakMinutes, setPomodoroFocusMinutes } from './actions';

export interface TimerRecorderProps {
  durations: Durations;
  /** Minutes recorded today, counted by the page; passed straight through to the card. */
  todayMinutes?: number;
  /** Today's resolved goal, or `null` before the owner set one. */
  todayGoalMinutes?: number | null;
}

/** The client mount: the page stays a display, this wrapper is what reaches the server action. */
export function TimerRecorder({
  durations,
  todayMinutes,
  todayGoalMinutes,
}: Readonly<TimerRecorderProps>) {
  return (
    <PomodoroPage
      durations={durations}
      onFocusLengthChange={setPomodoroFocusMinutes}
      onBreakLengthChange={setPomodoroBreakMinutes}
      onFocusBlockEnd={recordFocusSession}
      todayMinutes={todayMinutes}
      todayGoalMinutes={todayGoalMinutes}
    />
  );
}
