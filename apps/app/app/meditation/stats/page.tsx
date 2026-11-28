import { filterHref } from '@life/app-kit';
import { BarChart, Card, Facts, FactsRow, Kpi, ListShell, Segmented, Stack } from '@life/ui';
import { fetchSittingPage, type SittingRow } from '@/lib/meditation-api';
import { minuteUnit } from '@/lib/meditation-clock';
import { lensFor, type Lens, type LensSummary, type LensTotals } from '@/lib/meditation-stats';
import { getToday } from '@/lib/today';
import { MeditationNav } from '../meditation-nav';

export const dynamic = 'force-dynamic';

const STATS_PATH = '/meditation/stats';

const LENSES: readonly { value: Lens; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

/**
 * `/meditation/stats` — the lens (`SPEC-meditation-app` §1): the period rides the URL
 * (`?period=month`), the client's own local day anchors the window, and every bar is derived
 * here from the owner's sittings. Nothing is fetched as an aggregate, so a bar and the day
 * read beside it cannot be summed from two different row sets.
 */
export default async function MeditationStatsRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<{ period?: string }> }>) {
  const { period } = await searchParams;
  const lens = parseLens(period);
  const [sittings, today] = await Promise.all([readEverySitting(), getToday()]);
  const summary = lensFor(lens, sittings, today);

  return (
    <ListShell
      title="Stats"
      subtitle={windowLine(lens)}
      navTrailing={<MeditationNav />}
      filters={<LensFilter lens={lens} />}
      body={<LensBody lens={lens} summary={summary} />}
    />
  );
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
 * `ListShell` draws no step between its filter row and its body, so the stack opens on the section
 * step itself; the sibling bodies that start on a `Section` get that step from the section's own
 * top margin.
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
