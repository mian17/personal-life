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

  const running = timer.status === 'running';

  return (
    <Card fill>
      <Stack align="center">
        <StatusText>{PHASE_LABELS[timer.phase]}</StatusText>
        <Countdown remainingMs={timer.remainingMs} />
        <SessionPills phase={timer.phase} session={timer.session} />
        {/* Both waiting-state rows stay mounted and merely lose their paint:
            unmounting either one shrinks the card, and the centred stack pulls
            the whole read-out down by half the row it lost. */}
        <StatusText invisible={timer.status !== 'boundary'}>{timer.titles.next}</StatusText>
        <Button ref={timer.startRef} onClick={timer.startNext} invisible={running}>
          {startLabel(timer.nextPhase)}
        </Button>
      </Stack>
    </Card>
  );
}

/** The button names the phase it begins, so the owner reads the next step, not just "start". */
function startLabel(nextPhase: Phase): string {
  return nextPhase === 'focus' ? 'Start focus' : 'Start break';
}
