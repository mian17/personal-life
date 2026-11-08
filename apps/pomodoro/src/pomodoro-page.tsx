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
 * The break lengths offered at a boundary, where the owner still owns the next phase: the
 * break is chosen just before it starts, so these three are the quick-pick for the break the
 * Start button is about to begin. Same chip, same rule as the focus row — it sets the length
 * for the break in hand and reports it upward, or is a disabled button when nobody listens.
 */
const SHORT_BREAK_PRESETS = [5, 10, 15] as const;

/**
 * A long break is the cycle's real rest — it closes four focus blocks — so its row offers
 * three longer lengths, the shortest of them already the default short break's longest.
 */
const LONG_BREAK_PRESETS = [15, 25, 30] as const;

/** The two phases a focus block can lead to, which are the only phases with a break length. */
type BreakPhase = Exclude<Phase, 'focus'>;

/** Which row a boundary draws: the step it is about to start names its own presets. */
const BREAK_PRESETS: Record<BreakPhase, readonly number[]> = {
  short: SHORT_BREAK_PRESETS,
  long: LONG_BREAK_PRESETS,
};

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
  /** Told the break length a boundary chip picked, for the break that is about to start. */
  onBreakLengthChange?: (phase: BreakPhase, minutes: number) => void;
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
  onBreakLengthChange,
  onFocusBlockEnd,
  todayMinutes,
  todayGoalMinutes,
}: Readonly<PomodoroPageProps>) {
  // The chip choice starts as the stored one and then leads, so a tap re-seeds the timer
  // without waiting for the write to come back as a new prop. Memoised on the three
  // minutes, not on the object: `useDurationsApplied` re-seeds the timer whenever the
  // identity changes, and a fresh object per render would do that on every render.
  //
  // The two breaks keep a field each, because they are two lengths and not one: a pick made
  // for the short break must not become the long break's length an hour later.
  const [focusMinutes, setFocusMinutes] = useState(durations.focus);
  const [shortMinutes, setShortMinutes] = useState(durations.short);
  const [longMinutes, setLongMinutes] = useState(durations.long);
  const chosen = useMemo(
    () => ({ focus: focusMinutes, short: shortMinutes, long: longMinutes }),
    [focusMinutes, shortMinutes, longMinutes],
  );
  const timer = useTimer(chosen);
  const canReset = resetAllowed(timer.status);
  const finishedBlocks = completedFocuses(timer.phase, timer.status, timer.session);
  const presets = presetsFor(timer.status, timer.nextPhase);
  // The digits are a read-out of the length that will run next, not a second timer: at a
  // boundary the phase in hand is spent (`00:00`), while the phase Start will begin is the
  // one the row beside it is sizing. A phase in hand keeps its own remaining time, so a pick
  // can never move a fixed deadline — that stays `applyDurations`' rule, not a display one.
  const previewMs =
    timer.status === 'boundary' ? chosen[timer.nextPhase] * MINUTE_MS : timer.remainingMs;

  useFocusRecorded(
    {
      phase: timer.phase,
      startedPhaseMs: timer.startedPhaseMs,
      remainingMs: timer.remainingMs,
      status: timer.status,
    },
    onFocusBlockEnd,
  );

  function pickFocusLength(minutes: number): void {
    setFocusMinutes(minutes);
    onFocusLengthChange?.(minutes);
  }

  /** The chosen length of one of the two breaks: two lengths, never one shared value. */
  function breakMinutes(phase: BreakPhase): number {
    return phase === 'short' ? shortMinutes : longMinutes;
  }

  function pickBreakLength(phase: BreakPhase, minutes: number): void {
    if (phase === 'short') setShortMinutes(minutes);
    else setLongMinutes(minutes);
    onBreakLengthChange?.(phase, minutes);
  }

  return (
    <>
      <Card>
        <Stack>
          <StatusText className={phaseStyles}>{PHASE_LABELS[timer.phase]}</StatusText>
          <Countdown remainingMs={previewMs} />
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
          {/* ONE length row, and `presetsFor` is the only thing that decides which: a second
              row cannot exist by construction. A phase in flight keeps the row's box while it
              loses its paint (`visibility: hidden`), so the rows below it do not step up when
              it starts (the `StatusText` rule); the focus row is the one that stays there. */}
          {presets.kind === 'break' ? (
            <Row className={presetsStyles} role="group" aria-label="Break length">
              {BREAK_PRESETS[presets.phase].map((minutes) => (
                <Pill
                  key={minutes}
                  as="button"
                  size="filter"
                  active={minutes === breakMinutes(presets.phase)}
                  onClick={() => pickBreakLength(presets.phase, minutes)}
                  disabled={onBreakLengthChange == null}
                >
                  {`${minutes} min`}
                </Pill>
              ))}
            </Row>
          ) : (
            <Row
              className={cx(presetsStyles, presets.hidden && 'ui-invisible invisible')}
              role="group"
              aria-label="Focus length"
            >
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
          )}
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

/** The one length row the card draws. `hidden` keeps the row's box while the paint goes. */
type PresetRow =
  | { kind: 'focus'; hidden: boolean }
  | { kind: 'break'; phase: BreakPhase };

/**
 * The row the card draws, decided in one place: a length is configuration for the phase that
 * will run, so the row is named by what is about to start and nothing else can draw a second
 * one. A phase in flight has nothing to size, so the focus row stays there invisible — the
 * same row as the idle start, which keeps the box and the identity consistent. A boundary
 * leading to a break offers the break's lengths; a boundary after a break leads to a focus,
 * so it is back to the focus row.
 */
function presetsFor(status: Status, nextPhase: Phase): PresetRow {
  if (status === 'running' || status === 'paused') return { kind: 'focus', hidden: true };
  if (status === 'boundary' && nextPhase !== 'focus') return { kind: 'break', phase: nextPhase };
  return { kind: 'focus', hidden: false };
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
