import type { Metadata } from 'next';
import { readPrefNumber } from '@life/app-kit';
import { ListShell } from '@life/ui';
import { DEFAULT_DURATIONS, type Durations } from '@life/pomodoro';
import { listGoals, listSessions } from '@/lib/focus-api';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
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
        />
      }
    />
  );
}

/** What the day gave the card: an absent value draws no row. */
interface DayReadout {
  minutes?: number;
  goalMinutes?: number | null;
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
 * The day's two read-outs, from one `focus-service` round trip each.
 *
 * `focus-service` is not what the timer is: the card's rows are a read-out beside the
 * timer, so a service that is down must not take the timer down with it. Every branch
 * here degrades to "no value", which the card renders as no row (and `Section`
 * collapses). `today` is the client-resolved day, so a clock-less environment is the
 * same class of absent value.
 */
async function readDay(): Promise<DayReadout> {
  try {
    const today = await getToday();
    const [sessions, goals] = await Promise.all([listSessions(today, today), listGoals()]);
    return {
      minutes: sessions.reduce((total, session) => total + session.minutes, 0),
      goalMinutes: resolveGoal(goals, today),
    };
  } catch {
    return {};
  }
}
