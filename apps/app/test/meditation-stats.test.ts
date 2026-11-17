import type { SittingRow } from '@/lib/meditation-api';
import { lensFor } from '@/lib/meditation-stats';

/** One live sitting of `minutes`, ending on `day` at the local time its `endedAt` carries. */
function sittingOn(day: string, minutes: number, id = `${day}-${minutes}`): SittingRow {
  return {
    id,
    day,
    startedAt: `${day}T09:00:00.000Z`,
    endedAt: `${day}T09:00:00.000Z`,
    plannedMinutes: minutes,
    minutes,
    completed: true,
    deletedAt: null,
    createdAt: `${day}T09:00:00.000Z`,
  };
}

const TODAY = '2026-10-28';

describe('lensFor bars', () => {
  it('draws 7 daily bars for the week, empty days included', () => {
    const summary = lensFor('week', [sittingOn(TODAY, 10)], TODAY);

    expect(summary.bars).toHaveLength(7);
    expect(summary.bars[0].label).toBe('Thu');
    expect(summary.bars.at(-1)).toEqual({ label: 'Wed', value: 10 });
    expect(summary.bars.filter((bar) => bar.value === 0)).toHaveLength(6);
  });

  it('draws 30 daily bars for the month, empty days included', () => {
    const summary = lensFor('month', [sittingOn('2026-09-29', 5)], TODAY);

    expect(summary.bars).toHaveLength(30);
    expect(summary.bars[0]).toEqual({ label: '29 Sep', value: 5 });
    expect(summary.bars.at(-1)?.label).toBe('28 Oct');
  });

  it('draws 12 monthly bars for the year, empty months included', () => {
    const summary = lensFor('year', [sittingOn('2026-10-02', 7)], TODAY);

    expect(summary.bars).toHaveLength(12);
    expect(summary.bars[0].label).toBe('Nov 2025');
    expect(summary.bars[11]).toEqual({ label: 'Oct 2026', value: 7 });
    expect(summary.bars.filter((bar) => bar.value === 0)).toHaveLength(11);
  });
});

describe('lensFor bucket ranges', () => {
  it('holds exactly the sittings of each half-open day range', () => {
    const summary = lensFor(
      'week',
      [sittingOn('2026-10-21', 99), sittingOn('2026-10-22', 3), sittingOn(TODAY, 4)],
      TODAY,
    );

    // The day before the window is out, so its minutes land on no bar of this week.
    expect(summary.bars[0]).toEqual({ label: 'Thu', value: 3 });
    expect(summary.bars.at(-1)).toEqual({ label: 'Wed', value: 4 });
    expect(summary.totals.minutes).toBe(7);
  });

  it('adds several sittings of one day onto that day alone', () => {
    const summary = lensFor('week', [sittingOn(TODAY, 4, 'a'), sittingOn(TODAY, 6, 'b')], TODAY);

    expect(summary.bars.at(-1)?.value).toBe(10);
    expect(summary.totals.sittings).toBe(2);
  });

  it('holds each year bar to its own calendar month', () => {
    const summary = lensFor(
      'year',
      [sittingOn('2025-11-30', 2), sittingOn('2026-01-31', 3), sittingOn('2026-01-01', 5)],
      TODAY,
    );

    expect(summary.bars[0]).toEqual({ label: 'Nov 2025', value: 2 });
    expect(summary.bars[2]).toEqual({ label: 'Jan 2026', value: 8 });
    expect(summary.totals.minutes).toBe(10);
  });
});

describe('lensFor totals', () => {
  it('sums the visible bars into the window total and averages over the window sittings', () => {
    const summary = lensFor(
      'month',
      [sittingOn('2026-10-27', 10), sittingOn('2026-10-28', 5)],
      TODAY,
    );

    const barTotal = summary.bars.reduce((total, bar) => total + bar.value, 0);
    expect(summary.totals).toEqual({ minutes: 15, sittings: 2, averageMinutes: 8 });
    expect(summary.totals.minutes).toBe(barTotal);
  });

  it('reads an empty window as zero minutes, zero sittings and a zero average', () => {
    expect(lensFor('week', [], TODAY).totals).toEqual({
      minutes: 0,
      sittings: 0,
      averageMinutes: 0,
    });
  });
});

describe('lensFor soft deletes', () => {
  it('keeps a stamped sitting out of every bar, the total, the count and the average', () => {
    const summary = lensFor(
      'week',
      [
        sittingOn(TODAY, 10, 'live'),
        { ...sittingOn(TODAY, 60, 'stamped'), deletedAt: '2026-10-28T10:00:00.000Z' },
      ],
      TODAY,
    );

    expect(summary.bars.at(-1)?.value).toBe(10);
    expect(summary.totals).toEqual({ minutes: 10, sittings: 1, averageMinutes: 10 });
  });
});
