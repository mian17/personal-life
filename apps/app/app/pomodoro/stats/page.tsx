import { listGoals, listSessions, type SessionRow } from '@/lib/focus-api';
import { bucketsFor, resolveGoal, windowFor, type Period } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
import { StatsView } from './stats-view';

export const dynamic = 'force-dynamic';

const PERIODS: readonly Period[] = ['week', 'month', 'year'];

/**
 * The stats route: the URL carries the period and how many periods back it
 * reaches (`?period=month&offset=1`), the client-resolved `getToday()` anchors
 * the window, and the rows come from `focus-service` through the BFF. Nothing
 * here derives a day of its own, so the surface a shareable link names is the
 * surface the owner sees (lesson 0019).
 */
export default async function PomodoroStatsRoute({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ period?: string; offset?: string }>;
}>) {
  const { period: rawPeriod, offset: rawOffset } = await searchParams;
  const period = parsePeriod(rawPeriod);
  const offset = parseOffset(rawOffset);
  const today = await getToday();
  const statsWindow = windowFor(period, offset, today);

  // One fetch up to today, never just up to the shifted window: today's bar
  // measures today whatever period the owner is reading.
  const [sessions, goals] = await Promise.all([
    listSessions(statsWindow.from, today),
    listGoals(),
  ]);

  return (
    <StatsView
      buckets={bucketsFor(period, pairDaysWithMinutes(statsWindow.days, sessions), goals)}
      period={period}
      offset={offset}
      todayMinutes={minutesByDay(sessions).get(today) ?? 0}
      todayGoal={resolveGoal(goals, today)}
    />
  );
}

/** An absent or unknown `?period=` reads as the week filter, so a hand-typed URL still renders. */
function parsePeriod(raw: string | undefined): Period {
  return PERIODS.find((period) => period === raw) ?? 'week';
}

/**
 * The furthest back a window may sit: ten years of week windows, and the same
 * order of magnitude for the coarser periods — past any minute an owner could
 * have recorded, and small enough that walking the window stays cheap.
 * ponytail: a fixed ceiling instead of paging old history; make it a range query
 * when an owner actually holds a decade of records.
 */
const MAX_OFFSET = 520;

/**
 * An absent, negative, or fractional `?offset=` reads as the window ending today.
 *
 * A positive integer is clamped to `MAX_OFFSET` rather than trusted: every step
 * back is walked one day (or month) at a time, so an unclamped `?offset=1000000`
 * would block the request past the server timeout. The bound is the oldest window
 * worth drawing, so a hand-typed URL still renders minutes instead of throwing.
 */
function parseOffset(raw: string | undefined): number {
  const offset = Number(raw);
  return Number.isInteger(offset) && offset > 0 ? Math.min(offset, MAX_OFFSET) : 0;
}

/**
 * One row per window day, carrying that day's recorded minutes — zero when no
 * session landed on it. `bucketsFor` buckets by the dates its rows carry, so the
 * window's day list is what makes a session-less day still draw its bar.
 */
function pairDaysWithMinutes(days: string[], sessions: SessionRow[]): SessionRow[] {
  const minutes = minutesByDay(sessions);
  return days.map((day) => ({
    id: `day-${day}`,
    ownerSub: null,
    date: day,
    minutes: minutes.get(day) ?? 0,
    createdAt: `${day}T00:00:00.000Z`,
  }));
}

/** The owner's minutes per recorded day; several blocks on one day add up to that day's total. */
function minutesByDay(sessions: SessionRow[]): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const session of sessions) {
    minutes.set(session.date, (minutes.get(session.date) ?? 0) + session.minutes);
  }
  return minutes;
}
