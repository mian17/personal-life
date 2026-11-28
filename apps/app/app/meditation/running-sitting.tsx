'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Caption, Dialog, ProgressBar, Stack, StatusText } from '@life/ui';
import { ringIntervalBells } from '@/lib/meditation-bells';
import {
  bellScheduleFor,
  formatClock,
  remainingSeconds,
  sessionProgressPercent,
  type BellChoice,
  type RunningClock,
} from '@/lib/meditation-clock';

const MILLISECONDS_PER_SECOND = 1000;

/** One clock update per second: the read-out shows whole seconds, so a finer tick would only repaint. */
const TICK_MS = MILLISECONDS_PER_SECOND;

export interface RunningSittingProps {
  /** The instant the sitting started: the countdown's origin, and the row's `startedAt`. */
  startedAtMs: number;
  /** The length the idle stepper chose: this sitting's own plan, never the stored one. */
  plannedMinutes: number;
  bells: BellChoice;
  /** The sitting reached its planned length, so it records itself as complete. */
  onFinish: () => void;
  /** Stop was confirmed: the seconds it sat, which the record action keeps. */
  onEnd: (elapsedSeconds: number) => void;
}

/**
 * The running panel (`SPEC-ui-meditation-primitives` §1, §11, §12): the session line, the
 * countdown, the hairline track and the one action. The design collapses every setting away
 * while a sitting runs, so nothing on this screen competes with Stop.
 *
 * The countdown is the only live region, and it stays polite: the digits change at most once a
 * second, which is what the design's own timer asks for (`preview/index.html:96`).
 *
 * The name rides a bare `<section>`, because the landmark role is the section's alone; every
 * visual rule inside it is the centred `Stack`'s, so this file holds no layout class.
 */
export function RunningSitting({
  startedAtMs,
  plannedMinutes,
  bells,
  onFinish,
  onEnd,
}: Readonly<RunningSittingProps>) {
  const nowMs = useSecondTick();
  const clock: RunningClock = { startedAtMs, nowMs, plannedMinutes };
  const remaining = remainingSeconds(clock);
  const elapsedSeconds = Math.round((nowMs - startedAtMs) / MILLISECONDS_PER_SECOND);
  const [confirmingStop, setConfirmingStop] = useState(false);

  useIntervalBells(bells, plannedMinutes);
  useNaturalFinish(remaining, onFinish);

  return (
    <section aria-label="Session in progress">
      <Stack centred gap="xl">
        <Caption>{`Meditation · ${plannedMinutes} min`}</Caption>
        <StatusText aria-live="polite" figure size="display">
          {formatClock(remaining)}
        </StatusText>
        <ProgressBar height="s1" label="Session progress" value={sessionProgressPercent(clock)} />
        <Button size="bare" variant="filled" onClick={() => setConfirmingStop(true)}>
          Stop
        </Button>
        <StopConfirmSheet
          open={confirmingStop}
          onEnd={() => onEnd(elapsedSeconds)}
          onOpenChange={setConfirmingStop}
        />
      </Stack>
    </section>
  );
}

interface StopConfirmSheetProps {
  open: boolean;
  /** `false` is a dismissal — Escape, a backdrop press, or Keep going — and never ends the sitting. */
  onOpenChange: (open: boolean) => void;
  onEnd: () => void;
}

/**
 * The design's `#stop-dialog` (`preview/index.html:235-243`): one question, and the two answers
 * that close it. `dismiss={false}` is the primitive's confirm shape — no grab handle and no close
 * control — while Escape and a backdrop press still arrive as `onOpenChange(false)`, the same path
 * as Keep going, so dismissing the sheet leaves the countdown running where it was.
 *
 * ponytail: the copy says the minutes are not saved, and this app keeps the sitting
 * (`recordKeptSitting`). The wording is the design's contract and the write is the product's
 * decision, so the sentence stays verbatim; matching them is a design-owner call, not a code one.
 */
function StopConfirmSheet({ open, onOpenChange, onEnd }: Readonly<StopConfirmSheetProps>) {
  return (
    <Dialog
      description="The minutes you have sat are not saved."
      dismiss={false}
      open={open}
      size="sheet"
      title="End this session?"
      titleAlign="center"
      onOpenChange={onOpenChange}
    >
      <Stack gap="md">
        <Button variant="filled" onClick={() => onOpenChange(false)}>
          Keep going
        </Button>
        <Button variant="danger" onClick={onEnd}>
          End session
        </Button>
      </Stack>
    </Dialog>
  );
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
