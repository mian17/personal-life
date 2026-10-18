'use client';

import { Button, Card, PageShell, Row, Section, StatusText, Stack } from '@life/ui';
import { Countdown } from './countdown';
import { DurationFields } from './duration-fields';
import { SESSIONS_PER_CYCLE, type Durations, type Phase } from './timer';
import { useTimer } from './use-timer';

const PHASE_LABELS: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

export interface PomodoroPageProps {
  durations: Durations;
  onDurationsChange(next: Durations): void;
}

export function PomodoroPage({ durations, onDurationsChange }: PomodoroPageProps) {
  const timer = useTimer(durations);

  return (
    <PageShell>
      <Section label="Timer">
        <Card>
          <Stack>
            <StatusText>{PHASE_LABELS[timer.phase]}</StatusText>
            <Countdown remainingMs={timer.remainingMs} />
            <StatusText>{`Session ${timer.session} of ${SESSIONS_PER_CYCLE}`}</StatusText>
            <TimerControls
              running={timer.running}
              onStart={timer.startTimer}
              onPause={timer.pauseTimer}
              onReset={timer.resetTimer}
            />
          </Stack>
        </Card>
      </Section>
      <Section label="Durations">
        <DurationFields durations={durations} onDurationsChange={onDurationsChange} />
      </Section>
    </PageShell>
  );
}

interface TimerControlsProps {
  running: boolean;
  onStart(): void;
  onPause(): void;
  onReset(): void;
}

function TimerControls({ running, onStart, onPause, onReset }: TimerControlsProps) {
  return (
    <Row>
      <Button onClick={onStart} disabled={running}>
        Start
      </Button>
      <Button variant="ghost" onClick={onPause} disabled={!running}>
        Pause
      </Button>
      <Button variant="ghost" onClick={onReset}>
        Reset
      </Button>
    </Row>
  );
}
