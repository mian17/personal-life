import { filterHref } from '@life/app-kit';
import {
  BarChart,
  Card,
  Facts,
  FactsRow,
  Kpi,
  ManagerBlock,
  ProgressBar,
  Segmented,
  Stack,
  StatusText,
} from '@life/ui';
import {
  fetchDayDone,
  fetchGoals,
  fetchSittingPage,
  type DayDoneRow,
  type GoalRow,
  type SittingRow,
} from '@/lib/meditation-api';
import { minuteUnit } from '@/lib/meditation-clock';
import { lensFor, type Lens, type LensSummary, type LensTotals } from '@/lib/meditation-stats';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

const STATS_PATH = '/meditation/stats';

/** The title's quiet second line, the tier today's sentence sits on. */
const subtitleStyles = 'block text-[length:var(--fs-chip)]';

/** One step between today's sentence and the fill under it. */
const todayBarStyles = 'mt-[var(--s3)]';

/** The meta tier standing alone under the chart. No primitive draws static body copy (a
 * `StatusText` would claim a live region), so this stays a structural `<p>` carrying the meta
 * tier's token classes only — pomodoro's own treatment of the same note. */
const goalNoteStyles =
  'mt-[var(--s2)] text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

const LENSES: readonly { value: Lens; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

/**
 * `/meditation/stats` — the lens (`SPEC-meditation-app` §1): today's progress against today's
 * goal, then the period, which rides the URL (`?period=month`); the client's own local day anchors
 * the window, and every bar is derived here from the owner's sittings. Nothing is fetched as an
 * aggregate, so a bar and the day read beside it cannot be summed from two different row sets.
 */
export default async function MeditationStatsRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<{ period?: string }> }>) {
  const { period } = await searchParams;
  const lens = parseLens(period);
  const [sittings, goals, today] = await Promise.all([readEverySitting(), readGoals(), getToday()]);
  const day = await readDay(today);
  const summary = lensFor(lens, sittings, goals, today);

  return (
    <ManagerBlock title="Stats" backHref="/meditation" sub={windowLine(lens)}>
      <TodayProgress day={day} />
      <LensFilter lens={lens} />
      <LensBody lens={lens} summary={summary} />
      <GoalNote summary={summary} todayGoal={resolveGoal(goals, today)} />
    </ManagerBlock>
  );
}

/**
 * Today against today's goal, the first thing under the title: the same sentence and fill
 * `/pomodoro/stats` opens with, read from the same day row `/meditation` reads.
 *
 * No day row means no target: the line is left off rather than invented. A goal of `0` means
 * the owner set none, so the minutes stand alone — no bar, no "of 0", nothing to divide by.
 */
function TodayProgress({ day }: Readonly<{ day: DayDoneRow | null }>) {
  if (day === null) return null;

  const { liveMinutes, goalMinutes } = day;
  if (goalMinutes === 0) {
    return (
      <StatusText
        className={subtitleStyles}
      >{`${liveMinutes} ${minuteUnit(liveMinutes)} today`}</StatusText>
    );
  }

  return (
    <>
      <StatusText
        className={subtitleStyles}
      >{`${liveMinutes} of ${goalMinutes} minutes today`}</StatusText>
      <ProgressBar
        value={percentOf(liveMinutes, goalMinutes)}
        label={`Today: ${liveMinutes} of ${goalMinutes} minutes`}
        className={todayBarStyles}
      />
    </>
  );
}

/** How much of the goal the recorded minutes fill; the bar clamps it, the sentence says it plainly. */
function percentOf(minutes: number, goal: number): number {
  return (minutes / goal) * 100;
}

/** Today measured against the goal, or `null`: a failed read is a missing read-out, not a wrong one. */
async function readDay(today: string): Promise<DayDoneRow | null> {
  try {
    const [day] = await fetchDayDone(today, today);
    return day ?? null;
  } catch {
    return null;
  }
}

/** An absent or unknown `?period=` reads as the week lens, so a hand-typed URL still renders. */
function parseLens(raw: string | undefined): Lens {
  return LENSES.find((option) => option.value === raw)?.value ?? 'week';
}

/** What the window covers, in the one line under the title. */
function windowLine(lens: Lens): string {
  if (lens === 'week') return 'Last 7 days';
  if (lens === 'month') return 'Last 30 days';
  return 'Last 12 months';
}

/** The three lenses as route links: each one re-renders the page on its own window, no client state. */
function LensFilter({ lens }: Readonly<{ lens: Lens }>) {
  return (
    <Segmented
      aria-label="Stats window"
      items={LENSES.map((option) => ({
        href: filterHref({ path: STATS_PATH, overrides: { period: option.value } }),
        label: option.label,
        active: option.value === lens,
      }))}
    />
  );
}

/**
 * The window's chart, then the numbers read beside it — both derived from the same bars.
 *
 * `Segmented` carries no step below itself, so the stack opens on the section step itself; the
 * sibling bodies that start on a `Section` get that step from the section's own top margin.
 */
function LensBody({ lens, summary }: Readonly<{ lens: Lens; summary: LensSummary }>) {
  return (
    <Stack gap="lg" className="mt-[var(--s6)]">
      <Card>
        <BarChart data={summary.bars} label={`Meditation minutes per ${barMeasure(lens)}`} />
      </Card>
      <TotalsCard totals={summary.totals} />
    </Stack>
  );
}

/**
 * The legend for the chart's stepped line, drawn only when one is there: a window in which no
 * goal applied to any bar has nothing to explain, and the note is left off rather than pointing
 * at a line that is not drawn.
 *
 * The number is today's goal, the same aim the sentence above reads — never a bar's target, which
 * a year window sums over a month and a changed goal would name for the wrong day.
 */
function GoalNote({
  summary,
  todayGoal,
}: Readonly<{ summary: LensSummary; todayGoal: number | null }>) {
  const drawsTarget = summary.bars.some((bar) => bar.target !== undefined);
  if (!drawsTarget || todayGoal === null) return null;

  return <p className={goalNoteStyles}>{`Dashed line is the ${todayGoal} minute daily goal.`}</p>;
}

/** A year window's bars are months; a week's and a month's are days. */
function barMeasure(lens: Lens): string {
  return lens === 'year' ? 'month' : 'day';
}

/** The window in three numbers: the minutes it holds, how many sittings stood behind them, and their mean. */
function TotalsCard({ totals }: Readonly<{ totals: LensTotals }>) {
  return (
    <Card>
      <Stack gap="lg">
        <Kpi label="Sat in this window" value={totals.minutes} unit={minuteUnit(totals.minutes)} />
        <Facts>
          <FactsRow label="Sittings" value={totals.sittings} />
          <FactsRow
            label="Average per sitting"
            value={`${totals.averageMinutes} ${minuteUnit(totals.averageMinutes)}`}
          />
        </Facts>
      </Stack>
    </Card>
  );
}

/**
 * The owner's whole goal history, oldest first. A failed read is no history rather than a wrong
 * one: the chart then draws no goal line, which is exactly what an owner who set no goal sees.
 */
async function readGoals(): Promise<GoalRow[]> {
  try {
    return await fetchGoals();
  } catch {
    return [];
  }
}

/**
 * Every live sitting the owner has, the log's pages walked to their end: a year window reaches
 * past one page of rows, and a lens cannot bucket a window it only half holds. A stamped sitting
 * is already absent from these rows, and `lensFor` checks the stamp again on its own.
 */
async function readEverySitting(): Promise<SittingRow[]> {
  const sittings: SittingRow[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await fetchSittingPage(cursor);
    sittings.push(...page.sessions);
    if (page.nextCursor === null) return sittings;
    cursor = page.nextCursor;
  }
}
