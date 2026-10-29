import { filterHref } from '@life/app-kit';
import {
  BarChart,
  IconLink,
  ManagerBlock,
  Pill,
  PillGroup,
  ProgressBar,
  Section,
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

/**
 * The stats surface: today's progress against today's goal, then one chart of
 * the selected window with its per-bucket targets. Every control is a link, so
 * the whole screen is server-rendered and the URL alone decides which window the
 * owner reads — the period filter resets the window to today, and the shift
 * control steps it one period further back.
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
      <Section label="Today">
        <TodayProgress minutes={todayMinutes} goal={todayGoal} />
      </Section>

      <Section label="Trend">
        <PillGroup label="Period" actions={<ShiftBackLink period={period} offset={offset} />}>
          {PERIOD_LABELS.map(({ value, label }) => (
            <Pill
              key={value}
              size="filter"
              as="a"
              href={filterHref({ path: STATS_PATH, overrides: { period: value } })}
              active={value === period}
            >
              {label}
            </Pill>
          ))}
        </PillGroup>
        <BarChart data={buckets} label={`Focus minutes per ${bucketWidthName(period)}`} />
      </Section>
    </ManagerBlock>
  );
}

/**
 * Today as a fill and a sentence. With no goal resolved for today the bar would
 * have to invent a percentage, so the minutes stand alone instead: no fill, no
 * "of N", nothing claiming a target the owner never set.
 */
function TodayProgress({ minutes, goal }: Readonly<{ minutes: number; goal: number | null }>) {
  if (goal === null) return <StatusText>{`${minutes} minutes today`}</StatusText>;

  return (
    <>
      <StatusText>{`${minutes} of ${goal} minutes today`}</StatusText>
      <ProgressBar
        value={percentOf(minutes, goal)}
        label={`Today: ${minutes} of ${goal} minutes`}
      />
    </>
  );
}

/** How much of the goal the recorded minutes fill; the bar clamps it, the sentence says it plainly. */
function percentOf(minutes: number, goal: number): number {
  return (minutes / goal) * 100;
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
