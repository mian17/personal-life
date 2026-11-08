import { filterHref } from '@life/app-kit';
import {
  BarChart,
  Card,
  IconLink,
  ManagerBlock,
  ProgressBar,
  Section,
  Segmented,
  StatusText,
} from '@life/ui';
import { ChevronLeft } from 'lucide-react';
import type { Bucket, Period } from '@/lib/stats-buckets';

export interface StatsViewProps {
  /** One bar per window bucket, each carrying its target when a goal applied to it. */
  buckets: Bucket[];
  period: Period;
  /** How many periods back the window sits; `0` is the one ending today. */
  offset: number;
  todayMinutes: number;
  /** The goal today resolves to, `null` before any goal row applies. */
  todayGoal: number | null;
}

const PERIOD_LABELS: readonly { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const STATS_PATH = '/pomodoro/stats';

/** §8's `.phead__sub`: the display title's quiet second line, on its own line under it. */
const subtitleStyles = 'block text-[length:var(--fs-chip)]';

/** §8's `.row__meta` standing alone under the chart. No primitive draws static body copy (a
 * `StatusText` would claim a live region), so this stays a structural `<p>` carrying the meta
 * tier's token classes only. */
const goalNoteStyles =
  'mt-[var(--s2)] text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

/** §8's `.track mt3`: one step between today's sentence and the fill under it. */
const todayBarStyles = 'mt-[var(--s3)]';

/** §8's `.chart-box`: the panel's inset is the chart's, one step tighter at the sides and two at the foot. */
const chartBoxStyles = 'p-[var(--s3)]! pb-[var(--s2)]!';

/**
 * The stats surface: today's progress against today's goal, one segmented control for the
 * window, then that window's chart. Every control is a link, so the whole screen is
 * server-rendered and the URL alone decides which window the owner reads — the period filter
 * resets the window to today, and the shift control steps it one period further back.
 */
export function StatsView({
  buckets,
  period,
  offset,
  todayMinutes,
  todayGoal,
}: Readonly<StatsViewProps>) {
  return (
    <ManagerBlock title="Stats" backHref="/pomodoro">
      <TodayProgress minutes={todayMinutes} goal={todayGoal} />

      <Segmented
        aria-label="Chart window"
        items={PERIOD_LABELS.map(({ value, label }) => ({
          href: filterHref({ path: STATS_PATH, overrides: { period: value } }),
          label,
          active: value === period,
        }))}
      />

      <Section
        label="Focus minutes"
        count={`${totalMinutes(buckets)} min`}
        actions={<ShiftBackLink period={period} offset={offset} />}
      >
        <Card className={chartBoxStyles}>
          <BarChart data={buckets} label={`Focus minutes per ${bucketWidthName(period)}`} />
        </Card>
      </Section>

      {todayGoal !== null && (
        <p className={goalNoteStyles}>{`Dashed line is the ${todayGoal} minute daily goal.`}</p>
      )}
    </ManagerBlock>
  );
}

/**
 * Today as a sentence and a fill, sitting under the page title. With no goal resolved for
 * today the bar would have to invent a percentage, so the minutes stand alone instead: no
 * fill, no "of N", nothing claiming a target the owner never set.
 */
function TodayProgress({ minutes, goal }: Readonly<{ minutes: number; goal: number | null }>) {
  if (goal === null) {
    return <StatusText className={subtitleStyles}>{`${minutes} minutes today`}</StatusText>;
  }

  return (
    <>
      <StatusText className={subtitleStyles}>{`${minutes} of ${goal} minutes today`}</StatusText>
      <ProgressBar
        value={percentOf(minutes, goal)}
        label={`Today: ${minutes} of ${goal} minutes`}
        className={todayBarStyles}
      />
    </>
  );
}

/** How much of the goal the recorded minutes fill; the bar clamps it, the sentence says it plainly. */
function percentOf(minutes: number, goal: number): number {
  return (minutes / goal) * 100;
}

/** What the chart's heading states at its far end: the whole window in one number. */
function totalMinutes(buckets: Bucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.value, 0);
}

/** What one bar covers, so the chart's accessible name matches what it draws. */
function bucketWidthName(period: Period): string {
  return period === 'year' ? 'month' : 'day';
}

/** The one step back: the same period filter, one window earlier. */
function ShiftBackLink({ period, offset }: Readonly<{ period: Period; offset: number }>) {
  return (
    <IconLink
      href={filterHref({ path: STATS_PATH, overrides: { period, offset: String(offset + 1) } })}
      label="Earlier period"
    >
      <ChevronLeft size={20} aria-hidden />
    </IconLink>
  );
}
