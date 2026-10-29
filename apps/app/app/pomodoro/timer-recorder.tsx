'use client';

import { PomodoroPage, type Durations } from '@life/pomodoro';
import { recordFocusSession } from './actions';

export interface TimerRecorderProps {
  durations: Durations;
}

/** The client mount: the page stays a display, this wrapper is what reaches the server action. */
export function TimerRecorder({ durations }: Readonly<TimerRecorderProps>) {
  return <PomodoroPage durations={durations} onFocusBlockEnd={recordFocusSession} />;
}
