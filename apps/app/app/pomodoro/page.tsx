import type { Metadata } from 'next';
import { readPrefNumber } from '@life/app-kit';
import { ListShell } from '@life/ui';
import { DEFAULT_DURATIONS, type Durations, type FocusTaskChoice } from '@life/pomodoro';
import { listSessions, listGoals, type SessionRow } from '@/lib/focus-api';
import { listOpenTasks } from '@/lib/todo-api';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
import type { FocusQuestion } from './done-prompt';
import { PomodoroNav } from './pomodoro-nav';
import { TimerRecorder } from './timer-recorder';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Pomodoro' };

/** Thin mount: the durations and the day's read-outs come from the request, the page owns everything visual. */
export default async function PomodoroRoute() {
  const durations = await readDurations();
  const day = await readDay();

  return (
    <ListShell
      title="Focus"
      subtitle={`${durations.focus} minutes, then a ${durations.short} minute break`}
      navTrailing={<PomodoroNav />}
      body={
        <TimerRecorder
          durations={durations}
          todayMinutes={day.minutes}
          todayGoalMinutes={day.goalMinutes}
          tasks={day.tasks}
          pendingQuestion={day.pendingQuestion}
        />
      }
    />
  );
}

/** What the day gave the card: an absent value draws no row, an empty task list no picker. */
interface DayReadout {
  minutes?: number;
  goalMinutes?: number | null;
  /** The owner's open tasks; empty when the read failed or no read grant exists. */
  tasks: FocusTaskChoice[];
  /** A recorded block whose task question is still owed, derived from stored state. */
  pendingQuestion: FocusQuestion | null;
}

/** An absent or malformed cookie falls back to 25 / 5 / 15 minutes (`readPrefNumber`'s rule). */
async function readDurations(): Promise<Durations> {
  const [focus, short, long] = await Promise.all([
    readPrefNumber('pomodoro_focus', DEFAULT_DURATIONS.focus),
    readPrefNumber('pomodoro_short', DEFAULT_DURATIONS.short),
    readPrefNumber('pomodoro_long', DEFAULT_DURATIONS.long),
  ]);
  return { focus, short, long };
}

/**
 * The day's read-outs, each degradable on its own.
 *
 * `focus-service` is not what the timer is: the card's rows are a read-out beside the
 * timer, so a service that is down must not take the timer down with it. Every branch
 * here degrades to "no value", which the card renders as no row (and `Section`
 * collapses). `today` is the client-resolved day, so a clock-less environment is the
 * same class of absent value.
 *
 * The open tasks are read separately and degrade to an empty list: no read grant (403),
 * a service that is down, and an owner with nothing open all mean "no task list", and a
 * failed read is not a failed focus session.
 */
async function readDay(): Promise<DayReadout> {
  const today = await getToday();
  const [sessions, goals, tasks] = await Promise.all([
    safeSessions(today),
    safeGoals(),
    safeOpenTasks(),
  ]);

  return {
    minutes:
      sessions.length === 0 ? undefined : sessions.reduce((total, s) => total + s.minutes, 0),
    goalMinutes: resolveGoal(goals, today),
    tasks,
    pendingQuestion: pendingQuestionOf(sessions, tasks),
  };
}

/**
 * The question a closed tab left owing, derived from what the service stored.
 *
 * A block that named a task and has no answer yet is a question still owed — that is
 * the whole reason the answer is a column and not a client flag: the tab that recorded
 * the block may be gone, and the next load is what asks.
 *
 * The window is today's blocks, because a question about a task from some earlier day
 * has long stopped being answerable at a glance; the day is also what the screen already
 * reads, so the re-ask costs no second query. A task that is no longer open is skipped:
 * ticking it in the todos app answers the question implicitly, and asking about a closed
 * or deleted task would be asking the owner to answer something already true. The latest
 * such block wins, so the question is about the most recent work.
 */
function pendingQuestionOf(sessions: SessionRow[], tasks: FocusTaskChoice[]): FocusQuestion | null {
  const open = new Set(tasks.map((task) => task.id));
  const owed = sessions
    .filter((session) => session.todoId !== null && session.todoAnsweredAt === null)
    .filter((session) => open.has(session.todoId as string));

  const latest = owed.at(-1);
  if (latest === undefined) return null;
  const todoId = latest.todoId as string;
  return {
    sessionId: latest.id,
    todoId,
    minutes: latest.minutes,
    title: titleOf(tasks, todoId),
  };
}

/** The title a task id carries — the row holds the id only, so the task list is the reader. */
function titleOf(tasks: FocusTaskChoice[], todoId: string): string {
  return tasks.find((task) => task.id === todoId)?.title ?? 'that task';
}

/** Today's blocks, or none: a service that is down costs the day's read-out, never the timer. */
async function safeSessions(today: string): Promise<SessionRow[]> {
  try {
    return await listSessions(today, today);
  } catch {
    return [];
  }
}

/** The whole goal history, or none. */
async function safeGoals() {
  try {
    return await listGoals();
  } catch {
    return [];
  }
}

/** The owner's open tasks, or none — the picker's own degradation path. */
async function safeOpenTasks(): Promise<FocusTaskChoice[]> {
  try {
    return (await listOpenTasks()).map((task) => ({ id: task.id, title: task.title }));
  } catch {
    return [];
  }
}
