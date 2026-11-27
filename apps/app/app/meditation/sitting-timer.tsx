'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, ConfirmButton, Kpi, Stack, StatusText } from '@life/ui';
import { ringIntervalBells } from '@/lib/meditation-bells';
import {
  bellScheduleFor,
  cappedMinutes,
  formatClock,
  minuteUnit,
  remainingSeconds,
  type BellChoice,
} from '@/lib/meditation-clock';
import { recordFinishedSitting, recordKeptSitting, type SittingReport } from './actions';
import { IdleScreen } from './idle-screen';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** One clock update per second: the read-out shows whole seconds, so a finer tick would only repaint. */
const TICK_MS = MILLISECONDS_PER_SECOND;

/** A sitting in flight: the instant it started, which is both the countdown's origin and the row's `startedAt`. */
interface Sitting {
  startedAtMs: number;
  /** The length the idle stepper chose: this sitting's own plan, never the stored one. */
  plannedMinutes: number;
}

/** What a recorded sitting holds, which is all the completion screen shows. */
interface Recorded {
  minutes: number;
  completed: boolean;
}

/** One report's inputs: the sitting, and the seconds it sat. */
interface SittingReportInputs {
  sitting: Sitting;
  elapsedSeconds: number;
}

export interface SittingTimerProps {
  /** The settings' planned length: the idle stepper's seed, clamped into the design's range. */
  plannedMinutes: number;
  bells: BellChoice;
}

/**
 * A sitting's three screens in one client mount (`SPEC-meditation-app` §1, §5): idle, running,
 * and what it recorded.
 *
 * Nothing about a running sitting is persisted — a reload returns to idle rather than to a
 * countdown this tab can no longer honour (spec assumption 4) — and every return to idle asks the
 * server to read the day again, so the subtitle counts the sitting that just ended.
 */
export function SittingTimer({ plannedMinutes, bells }: Readonly<SittingTimerProps>) {
  const router = useRouter();
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);

  function startSitting(minutes: number): void {
    setRecorded(null);
    setSitting({ startedAtMs: Date.now(), plannedMinutes: minutes });
  }

  async function finishSitting(): Promise<void> {
    if (sitting === null) return;
    const elapsedSeconds = sitting.plannedMinutes * SECONDS_PER_MINUTE;
    await recordFinishedSitting(sittingRun({ sitting, elapsedSeconds }));
    showRecorded({ minutes: sitting.plannedMinutes, completed: true });
  }

  async function keepSitting(elapsedSeconds: number): Promise<void> {
    if (sitting === null) return;
    await recordKeptSitting(sittingRun({ sitting, elapsedSeconds }));
    showRecorded({
      minutes: cappedMinutes(elapsedSeconds, sitting.plannedMinutes),
      completed: false,
    });
  }

  /** Both endings leave the countdown first, so no bell can ring on a screen that has moved on. */
  function showRecorded(result: Recorded): void {
    setSitting(null);
    setRecorded(result);
  }

  /** An abandoned sitting sends nothing at all, so leaving the countdown is the whole action. */
  function abandonSitting(): void {
    setSitting(null);
  }

  /** Back to idle with a freshly read day: the sitting that just ended has to show in it. */
  function returnToIdle(): void {
    setRecorded(null);
    router.refresh();
  }

  if (sitting !== null) {
    return (
      <RunningSitting
        sitting={sitting}
        plannedMinutes={sitting.plannedMinutes}
        bells={bells}
        onFinish={() => void finishSitting()}
        onKeep={(elapsedSeconds) => void keepSitting(elapsedSeconds)}
        onAbandon={abandonSitting}
      />
    );
  }

  if (recorded !== null) return <RecordedSitting recorded={recorded} onDone={returnToIdle} />;

  return <IdleScreen plannedMinutes={plannedMinutes} bells={bells} onStart={startSitting} />;
}

interface RunningSittingProps {
  sitting: Sitting;
  plannedMinutes: number;
  bells: BellChoice;
  onFinish: () => void;
  onKeep: (elapsedSeconds: number) => void;
  onAbandon: () => void;
}

/** The countdown, the bells it rings, and the two ways it can stop early. */
function RunningSitting({
  sitting,
  plannedMinutes,
  bells,
  onFinish,
  onKeep,
  onAbandon,
}: Readonly<RunningSittingProps>) {
  const nowMs = useSecondTick();
  const remaining = remainingSeconds({ startedAtMs: sitting.startedAtMs, nowMs, plannedMinutes });
  const elapsedSeconds = Math.round((nowMs - sitting.startedAtMs) / MILLISECONDS_PER_SECOND);
  const minutesSoFar = cappedMinutes(elapsedSeconds, plannedMinutes);
  const minutesLabel = `${minutesSoFar} ${minuteUnit(minutesSoFar)}`;

  useIntervalBells(bells, plannedMinutes);
  useNaturalFinish(remaining, onFinish);

  return (
    <Card>
      <Stack gap="lg" align="center">
        <StatusText size="display">{formatClock(remaining)}</StatusText>
        <Stack gap="sm">
          <ConfirmButton
            message={`End and keep ${minutesLabel}?`}
            onClick={() => onKeep(elapsedSeconds)}
          >
            {`End & keep ${minutesLabel}`}
          </ConfirmButton>
          <ConfirmButton
            variant="ghost"
            message="Discard this sitting? Nothing will be recorded."
            onClick={onAbandon}
          >
            Discard sitting
          </ConfirmButton>
        </Stack>
      </Stack>
    </Card>
  );
}

/** What the sitting recorded: the minutes it reached, and whether that was its planned length. */
function RecordedSitting({
  recorded,
  onDone,
}: Readonly<{ recorded: Recorded; onDone: () => void }>) {
  return (
    <Card>
      <Stack gap="lg" align="center">
        <Kpi
          label={recorded.completed ? 'Session complete' : 'Saved'}
          value={recorded.minutes}
          unit={minuteUnit(recorded.minutes)}
        />
        <Button onClick={onDone}>Done</Button>
      </Stack>
    </Card>
  );
}

/**
 * One sitting as the record action takes it: the instant it started, the length it was planned
 * for, and the seconds it sat. The ISO string is derived here rather than carried alongside the
 * millisecond origin, so the two can never name different instants.
 */
function sittingRun({ sitting, elapsedSeconds }: SittingReportInputs): SittingReport {
  return {
    startedAt: new Date(sitting.startedAtMs).toISOString(),
    plannedMinutes: sitting.plannedMinutes,
    elapsedSeconds,
  };
}

/** The browser's clock, read once a second while the countdown is mounted. */
function useSecondTick(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return nowMs;
}

/**
 * Schedule the sitting's bells once, from `intervalBellTimes`, and silence what has not rung when
 * the countdown unmounts. The schedule's own fields are the dependencies rather than the object,
 * so a parent re-render cannot re-arm bells the sitting already rang.
 */
function useIntervalBells(bells: BellChoice, plannedMinutes: number): void {
  const { enabled, offsetSec, intervalSec, repeat } = bells;

  useEffect(() => {
    const schedule = bellScheduleFor({ enabled, offsetSec, intervalSec, repeat }, plannedMinutes);
    if (schedule === null) return;
    return ringIntervalBells(schedule);
  }, [enabled, offsetSec, intervalSec, repeat, plannedMinutes]);
}

/** A sitting that reaches its planned length records itself, exactly once. */
function useNaturalFinish(remaining: number, onFinish: () => void): void {
  const finished = useRef(false);

  useEffect(() => {
    if (remaining > 0 || finished.current) return;
    finished.current = true;
    onFinish();
  }, [remaining, onFinish]);
}
