'use client';

import { Button, Card, StatusText, Stack } from '@life/ui';
import { Countdown } from './countdown';
import { SessionPills } from './session-pills';
import type { Durations, Phase } from './timer';
import { useTimer } from './use-timer';

const PHASE_LABELS: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

export interface PomodoroPageProps {
  durations: Durations;
}

export function PomodoroPage({ durations }: PomodoroPageProps) {
  const timer = useTimer(durations);

  return (
    <Card>
      <Stack align="center">
        <StatusText>{PHASE_LABELS[timer.phase]}</StatusText>
        <Countdown remainingMs={timer.remainingMs} />
        <SessionPills phase={timer.phase} session={timer.session} />
        {timer.status === 'boundary' && <StatusText>{timer.titles.next}</StatusText>}
        {timer.status !== 'running' && (
          <Button ref={timer.startRef} onClick={timer.startNext}>
            {startLabel(timer.nextPhase)}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

/** The button names the phase it begins, so the owner reads the next step, not just "start". */
function startLabel(nextPhase: Phase): string {
  return nextPhase === 'focus' ? 'Start focus' : 'Start break';
}
