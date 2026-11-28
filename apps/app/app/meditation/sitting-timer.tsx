'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cappedMinutes, type BellChoice } from '@/lib/meditation-clock';
import { recordFinishedSitting, recordKeptSitting, type SittingReport } from './actions';
import { CompleteSitting, type SittingResult } from './complete-sitting';
import { IdleScreen } from './idle-screen';
import type { SaveBells } from './interval-bells-sheet';
import { RunningSitting } from './running-sitting';

const SECONDS_PER_MINUTE = 60;

/** A sitting in flight: the instant it started, which is both the countdown's origin and the row's `startedAt`. */
interface Sitting {
  startedAtMs: number;
  /** The length the idle stepper chose: this sitting's own plan, never the stored one. */
  plannedMinutes: number;
}

export interface SittingTimerProps {
  /** The settings' planned length: the idle stepper's seed, clamped into the design's range. */
  plannedMinutes: number;
  bells: BellChoice;
  /**
   * The interval bells sheet's write, handed straight to the idle screen: the settings `PUT` goes
   * through the server route, because the service client answers on the server alone.
   */
  onSaveBells?: SaveBells;
}

/**
 * A sitting's three screens in one client mount (`SPEC-meditation-app` §1, §5): idle, running,
 * and what it recorded.
 *
 * Nothing about a running sitting is persisted — a reload returns to idle rather than to a
 * countdown this tab can no longer honour (spec assumption 4) — and every return to idle asks the
 * server to read the day again, so the subtitle counts the sitting that just ended.
 */
export function SittingTimer({ plannedMinutes, bells, onSaveBells }: Readonly<SittingTimerProps>) {
  const router = useRouter();
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [result, setResult] = useState<SittingResult | null>(null);

  function startSitting(minutes: number): void {
    setResult(null);
    setSitting({ startedAtMs: Date.now(), plannedMinutes: minutes });
  }

  async function finishSitting(): Promise<void> {
    if (sitting === null) return;
    await recordFinishedSitting(sittingRun(sitting, sitting.plannedMinutes * SECONDS_PER_MINUTE));
    showResult({ minutes: sitting.plannedMinutes, completed: true });
  }

  /** A stopped sitting is kept, not discarded: the minutes sat are the product's record of it. */
  async function endSitting(elapsedSeconds: number): Promise<void> {
    if (sitting === null) return;
    await recordKeptSitting(sittingRun(sitting, elapsedSeconds));
    showResult({
      minutes: cappedMinutes(elapsedSeconds, sitting.plannedMinutes),
      completed: false,
    });
  }

  /** Both endings leave the countdown first, so no bell can ring on a screen that has moved on. */
  function showResult(next: SittingResult): void {
    setSitting(null);
    setResult(next);
  }

  /** Back to idle with a freshly read day: the sitting that just ended has to show in it. */
  function returnToIdle(): void {
    setResult(null);
    router.refresh();
  }

  if (sitting !== null) {
    return (
      <RunningSitting
        bells={bells}
        plannedMinutes={sitting.plannedMinutes}
        startedAtMs={sitting.startedAtMs}
        onEnd={(elapsedSeconds) => void endSitting(elapsedSeconds)}
        onFinish={() => void finishSitting()}
      />
    );
  }

  if (result !== null) return <CompleteSitting result={result} onDone={returnToIdle} />;

  return (
    <IdleScreen
      bells={bells}
      plannedMinutes={plannedMinutes}
      onSaveBells={onSaveBells}
      onStart={startSitting}
    />
  );
}

/**
 * One sitting as the record action takes it: the instant it started, the length it was planned
 * for, and the seconds it sat. The ISO string is derived here rather than carried alongside the
 * millisecond origin, so the two can never name different instants.
 */
function sittingRun(sitting: Sitting, elapsedSeconds: number): SittingReport {
  return {
    startedAt: new Date(sitting.startedAtMs).toISOString(),
    plannedMinutes: sitting.plannedMinutes,
    elapsedSeconds,
  };
}
