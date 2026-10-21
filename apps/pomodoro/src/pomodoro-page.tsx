'use client';

import { Button, Card, ConfirmButton, Row, StatusText, Stack } from '@life/ui';
import { Countdown } from './countdown';
import { SessionPills } from './session-pills';
import type { Durations, Phase, Status } from './timer';
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
  const canReset = resetAllowed(timer.status, timer.session);

  return (
    <Card fill>
      <Stack align="center">
        <StatusText>{PHASE_LABELS[timer.phase]}</StatusText>
        <Countdown remainingMs={timer.remainingMs} />
        <SessionPills phase={timer.phase} session={timer.session} />
        {/* Both waiting-state rows stay mounted and merely lose their paint:
            unmounting either one shrinks the card, and the centred stack pulls
            the whole read-out down by half the row it lost. The action row needs
            none of that: every status puts a button in the same slot. */}
        <StatusText invisible={timer.status !== 'boundary'}>{timer.titles.next}</StatusText>
        <Row>
          {/* Reset ends the whole cycle, so it asks first — and only where there
              is something to give up (see `resetAllowed`). */}
          <ConfirmButton
            variant="ghost"
            message="Reset the timer and start the cycle over at session 1?"
            onClick={timer.resetCycle}
            disabled={!canReset}
          >
            Reset
          </ConfirmButton>
          <Button ref={timer.startRef} onClick={timer.primaryAction}>
            {primaryLabel(timer.status, timer.nextPhase)}
          </Button>
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * Reset discards progress, so it is offered only where progress exists: a paused
 * phase (the frozen time is exactly what would be thrown away) or a boundary past
 * the first session. Not while a phase runs — a confirm dialog counting down
 * underneath is a trap — and not in the first session, where the cycle is already
 * at its start.
 */
function resetAllowed(status: Status, session: number): boolean {
  return status === 'paused' || (status === 'boundary' && session > 1);
}

/** Pause and resume say what they do; a stopped timer names the phase it begins. */
function primaryLabel(status: Status, nextPhase: Phase): string {
  if (status === 'running') return 'Pause';
  if (status === 'paused') return 'Resume';
  return startLabel(nextPhase);
}

/** The button names the phase it begins, so the owner reads the next step, not just "start". */
function startLabel(nextPhase: Phase): string {
  return nextPhase === 'focus' ? 'Start focus' : 'Start break';
}
