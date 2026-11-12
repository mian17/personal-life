'use client';

import { PomodoroPage, type Durations, type FocusTaskChoice } from '@life/pomodoro';
import { useRef, useState } from 'react';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { recordFocusSession, setPomodoroBreakMinutes, setPomodoroFocusMinutes } from './actions';
import { DonePrompt, type FocusQuestion } from './done-prompt';

/**
 * How long a chip pick waits before it is written. Shorter than the toggle window
 * (`TOGGLE_DEBOUNCE_MS`) because the two wait for different things: a toggle is a state
 * flip the owner may still be exploring, while a chip is a length the page is already
 * previewing — the tap has chosen, and only the burst needs to settle before it persists.
 */
export const PRESET_FLUSH_MS = 250;

/** The three lengths a chip can pick, each with its own cookie on the server. */
type LengthKey = 'focus' | 'short' | 'long';

export interface TimerRecorderProps {
  durations: Durations;
  /** Minutes recorded today, counted by the page; passed straight through to the card. */
  todayMinutes?: number;
  /** Today's resolved goal, or `null` before the owner set one. */
  todayGoalMinutes?: number | null;
  /** The owner's open tasks; empty draws no picker and no task can be named. */
  tasks?: FocusTaskChoice[];
  /** A block the service still owes an answer for — what a closed tab left behind. */
  pendingQuestion?: FocusQuestion | null;
}

/**
 * The client mount: the page stays a display, this wrapper is what reaches the server action.
 *
 * The page is already optimistic — a chip sets the length in its own state, so the chip lights
 * up and the countdown previews the choice on the same tap. What is left to decide is the
 * write, and it is decided here rather than in `@life/pomodoro`: one tap per tap would fire a
 * server action that rewrites a cookie and revalidates the whole layout, so a burst of taps
 * would cost a revalidation each. The page keeps its plain `(minutes) => void` signature and
 * any host can pick its own write policy; this host settles the burst into one request.
 */
export function TimerRecorder({
  durations,
  todayMinutes,
  todayGoalMinutes,
  tasks = [],
  pendingQuestion = null,
}: Readonly<TimerRecorderProps>) {
  // What the server has been told, one baseline per length. A third of the point of the
  // baseline is the return trip: 25 → 50 → 25 leaves the server exactly where it already was,
  // so writing it would buy a cookie rewrite and a layout revalidation for no change at all.
  // ponytail: seeded once, from a copy — the ref is written to, so it must never alias the
  // prop the parent still owns. A preference changed elsewhere remounts this component, so
  // the prop only ever moves to a value one of these baselines already recorded; re-seed it
  // if a same-page settings write is ever added.
  const settled = useRef<Durations>({ ...durations });

  // One settle window per length, not one shared: the hook keeps a single pending action, so a
  // shared channel would let a break pick swallow a focus pick made a moment earlier. Three
  // lengths are three choices and owe three independent writes.
  const settleFocus = useDebouncedCallback(PRESET_FLUSH_MS);
  const settleShortBreak = useDebouncedCallback(PRESET_FLUSH_MS);
  const settleLongBreak = useDebouncedCallback(PRESET_FLUSH_MS);
  const flushLength: Record<LengthKey, (fn: () => void) => void> = {
    focus: settleFocus,
    short: settleShortBreak,
    long: settleLongBreak,
  };

  // The task the next block will name. A pick made here rides the record call, so the
  // block and the task it worked on are one write; unset is the ordinary case and stays
  // fully valid.
  const [todoId, setTodoId] = useState<string | null>(null);

  // The question a recorded block raises, seeded from stored state so a tab closed at
  // the boundary still asks on the next load. The id is the only thing the row holds,
  // so the title is resolved here, against the task list this render already has.
  const [question, setQuestion] = useState<FocusQuestion | null>(pendingQuestion);

  /** The title a task id carries, for the prompt's sentence. */
  function titleOf(taskId: string): string {
    return tasks.find((task) => task.id === taskId)?.title ?? 'that task';
  }

  /** Report a picked length once the taps stop, carrying the value its row settled on. */
  function reportLength(length: LengthKey, minutes: number): void {
    flushLength[length](() => {
      if (settled.current[length] === minutes) return;

      // The baseline advances with the attempt, so the burst's own final value is the only
      // thing ever sent. A rejected write is left to the server action's own failure logging —
      // the page has no error surface for a cookie and the timer already runs on the choice —
      // and a later pick of a different value corrects the baseline.
      settled.current[length] = minutes;
      if (length === 'focus') void setPomodoroFocusMinutes(minutes);
      else void setPomodoroBreakMinutes(length, minutes);
    });
  }

  /**
   * Record the block, then raise the question it earned.
   *
   * The same `minutes >= 1` condition is what `useFocusRecorded` already gates on, so
   * both record moments (the boundary and a stop mid-focus) reach this one place: the
   * prompt can neither appear without a saved block nor be missing after one. Only a
   * block that named a task asks anything, and only the row the service stored names the
   * session the answer is written against.
   */
  async function record(minutes: number): Promise<void> {
    const chosen = todoId;
    const saved = await recordFocusSession(minutes, chosen ?? undefined);
    if (saved === null || chosen === null) return;

    setQuestion({ sessionId: saved.id, todoId: chosen, minutes, title: titleOf(chosen) });
  }

  return (
    <>
      <PomodoroPage
        durations={durations}
        onFocusLengthChange={(minutes) => reportLength('focus', minutes)}
        onBreakLengthChange={(phase, minutes) => reportLength(phase, minutes)}
        // A finished block is a record of something that already happened, and it fires once,
        // so it goes straight through: delaying it would delay the day's total for no burst.
        onFocusBlockEnd={(minutes) => void record(minutes)}
        todayMinutes={todayMinutes}
        todayGoalMinutes={todayGoalMinutes}
        tasks={tasks}
        todoId={todoId}
        onTodoIdChange={setTodoId}
      />
      <DonePrompt question={question} onAnswered={() => setQuestion(null)} />
    </>
  );
}
