'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  ConfirmButton,
  List,
  ListItem,
  Pill,
  ProgressBar,
  Row,
  Section,
  Stack,
  StatusText,
  cx,
} from '@life/ui';
import { Countdown } from './countdown';
import { useFocusRecorded } from './focus-recorder';
import { completedFocuses, SessionPills } from './session-pills';
import { MINUTE_MS, SESSIONS_PER_CYCLE, type Durations, type Phase, type Status } from './timer';
import { useTimer } from './use-timer';

const PHASE_LABELS: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

/**
 * The three focus lengths the reference draws as chips, in minutes. The row is a
 * quick-pick: a chip both sets the length and reports it upward for persistence, so it
 * stays in sync with the same preference `/pomodoro/settings` edits. A chip is a button
 * and not a label because it changes the timer; with no one to report to, it is a
 * disabled button instead — a label that looks pressable would be a lie either way.
 */
const FOCUS_PRESETS = [15, 25, 50] as const;

/**
 * §8's `.timer__phase`: the small-caps label over the digits. The section-label row of
 * §4's scale is that treatment — 13px, 650, wide tracking — and the uppercase is the
 * reference's own; the text itself stays untouched, so locators still read `Focus`.
 */
const phaseStyles = cx(
  'uppercase',
  'text-[length:var(--fs-section-label)]',
  '[font-weight:var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/** §8's `.timer__hint`: the line is reserved always, so the reservation is one `--s4`
 *  row. The digits-to-track distance is then `--s2` + `--s4` + `--s2` = `--s8`, on the
 *  ladder; the track adds no margin of its own or the sum lands at 36. */
const hintStyles =
  'h-[var(--s4)] overflow-hidden leading-[var(--lh-control)] text-[length:var(--fs-label)]';

/** §8's `.filters` owns its top step; the stack supplies the rest. The track it follows
 *  adds none — see `hintStyles`: its own step is what would land the band off the ladder. */
const presetsStyles = 'mt-[var(--s1)]';

/** §8's `.dots.mt4` and `.btn-row.mt4`. */
const dotsStyles = 'mt-[var(--s2)]';
const actionsStyles = 'mt-[var(--s2)]';

export interface PomodoroPageProps {
  durations: Durations;
  /** Told the focus length a chip picked, so the choice survives a reload. */
  onFocusLengthChange?: (minutes: number) => void;
  /** Told the minutes of every focus block that ends, so the owner's day keeps them. */
  onFocusBlockEnd?: (minutes: number) => void;
  /** Minutes recorded today; absent, the Today group has no first row to draw. */
  todayMinutes?: number;
  /** The day's goal in minutes: total focus for the whole day, not one block. */
  todayGoalMinutes?: number | null;
}

export function PomodoroPage({
  durations,
  onFocusLengthChange,
  onFocusBlockEnd,
  todayMinutes,
  todayGoalMinutes,
}: Readonly<PomodoroPageProps>) {
  // The chip choice starts as the stored one and then leads, so a tap re-seeds the timer
  // without waiting for the write to come back as a new prop. Memoised on the three
  // minutes, not on the object: `useDurationsApplied` re-seeds the timer whenever the
  // identity changes, and a fresh object per render would do that on every render.
  const [focusMinutes, setFocusMinutes] = useState(durations.focus);
  const chosen = useMemo(
    () => ({ focus: focusMinutes, short: durations.short, long: durations.long }),
    [focusMinutes, durations.short, durations.long],
  );
  const timer = useTimer(chosen);
  const canReset = resetAllowed(timer.status);
  const finishedBlocks = completedFocuses(timer.phase, timer.status, timer.session);

  useFocusRecorded(
    { phase: timer.phase, durations: chosen, remainingMs: timer.remainingMs, status: timer.status },
    onFocusBlockEnd,
  );

  function pickFocusLength(minutes: number): void {
    setFocusMinutes(minutes);
    onFocusLengthChange?.(minutes);
  }

  return (
    <>
      <Card>
        <Stack>
          <StatusText className={phaseStyles}>{PHASE_LABELS[timer.phase]}</StatusText>
          <Countdown remainingMs={timer.remainingMs} />
          {/* The waiting-state line stays mounted and merely loses its paint: unmounting
              it shrinks the card, and every row below it would step up by its height. The
              action row needs none of that: every status puts a button in the same slot. */}
          <StatusText className={hintStyles} invisible={timer.status !== 'boundary'}>
            {timer.titles.next}
          </StatusText>
          <ProgressBar
            value={percentSpent(timer.remainingMs, timer.phase, chosen)}
            label="Session progress"
          />
          <Row className={presetsStyles} role="group" aria-label="Focus length">
            {FOCUS_PRESETS.map((minutes) => (
              <Pill
                key={minutes}
                as="button"
                size="filter"
                active={minutes === focusMinutes}
                onClick={() => pickFocusLength(minutes)}
                disabled={onFocusLengthChange == null}
              >
                {`${minutes} min`}
              </Pill>
            ))}
          </Row>
          <SessionPills
            phase={timer.phase}
            status={timer.status}
            session={timer.session}
            className={dotsStyles}
          />
          <Row className={actionsStyles}>
            <Button
              ref={timer.startRef}
              className="grow basis-0"
              onClick={timer.primaryAction}
            >
              {primaryLabel(timer.status, timer.nextPhase)}
            </Button>
            {/* Reset ends the whole cycle, so it asks first — and only where there is
                something to give up (see `resetAllowed`). */}
            <ConfirmButton
              variant="ghost"
              className="w-auto!"
              message="Reset the timer and start the cycle over at session 1?"
              onClick={timer.resetCycle}
              disabled={!canReset}
            >
              Reset
            </ConfirmButton>
          </Row>
        </Stack>
      </Card>
      {/* The count is the cycle's own progress; the two rows are the day the service
          recorded. A day with neither value draws no rows, and `Section` collapses a
          group whose list came out empty. */}
      <Section label="Today" count={`${finishedBlocks} of ${SESSIONS_PER_CYCLE}`}>
        <List>
          {todayMinutes != null && (
            <ListItem
              title="Focus minutes"
              trailing={<Pill tone="done">{`${todayMinutes} min`}</Pill>}
            />
          )}
          {/* The goal is a day's total focus, so the row reads the day against it in the
              same "X of Y" the stats screen's Today line uses, and the two cannot disagree. */}
          {todayMinutes != null && todayGoalMinutes != null && (
            <ListItem
              title="Daily goal"
              trailing={<Pill>{`${todayMinutes} of ${todayGoalMinutes} min`}</Pill>}
            />
          )}
        </List>
      </Section>
    </>
  );
}

/** How much of the phase is behind the timer, as the percent the track fills. */
function percentSpent(remainingMs: number, phase: Phase, durations: Durations): number {
  const phaseMs = durations[phase] * MINUTE_MS;
  if (phaseMs <= 0) return 0;
  return ((phaseMs - remainingMs) / phaseMs) * 100;
}

/**
 * Reset discards progress, so it is offered wherever there is any: paused, a phase
 * waiting at its boundary, mid-break. A finished focus is progress even while the
 * break button sits unpressed, so the boundary right after session 1 qualifies.
 * Only two states refuse it — a counting-down phase, because a confirm dialog
 * ticking underneath is a trap, and the untouched start, where reset would be a
 * no-op. `idle` is that start and nothing else: the machine never idles mid-cycle.
 */
function resetAllowed(status: Status): boolean {
  return status !== 'running' && status !== 'idle';
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
