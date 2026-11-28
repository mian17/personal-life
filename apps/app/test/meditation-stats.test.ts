import type { ReactElement } from 'react';
import * as ui from '@life/ui';
import { ProgressBar, Segmented, StatusText } from '@life/ui';

jest.mock('@/lib/meditation-api', () => ({
  fetchSittingPage: jest.fn(),
  fetchDayDone: jest.fn(),
}));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import {
  fetchDayDone,
  fetchSittingPage,
  type DayDoneRow,
  type SittingRow,
} from '@/lib/meditation-api';
import { lensFor } from '@/lib/meditation-stats';
import { getToday } from '@/lib/today';
import MeditationStatsRoute from '@/app/meditation/stats/page';

const mockedFetchSittingPage = fetchSittingPage as jest.MockedFunction<typeof fetchSittingPage>;
const mockedFetchDayDone = fetchDayDone as jest.MockedFunction<typeof fetchDayDone>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

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

/** One day row as `GET /sessions/days` answers it: the day's live minutes against the current goal. */
function dayRow(liveMinutes: number, goalMinutes: number): DayDoneRow {
  return { date: TODAY, liveMinutes, goalMinutes, done: liveMinutes >= goalMinutes };
}

/** Every `@life/ui` primitive by value: the expansion below stops at these. */
const PRIMITIVES = new Set<unknown>(Object.values(ui));

type Node = ReactElement<Record<string, unknown>>;

/** The route's `ManagerBlock` children, each expanded into the primitives it returns. */
async function statsSections(): Promise<unknown[]> {
  mockedFetchSittingPage.mockResolvedValue({
    sessions: [sittingOn(TODAY, 10)],
    nextCursor: null,
    total: 1,
  });
  mockedGetToday.mockResolvedValue(TODAY);

  const page = await MeditationStatsRoute({ searchParams: Promise.resolve({}) });
  const children = expand(page).props.children as unknown;
  return (Array.isArray(children) ? children : [children]).map(expand);
}

/** The route's output with the page's own components expanded, stopping at every primitive. */
function expand(node: unknown): Node {
  if (!isElement(node)) return node as unknown as Node;
  if (typeof node.type === 'function' && !PRIMITIVES.has(node.type)) {
    return expand((node.type as (props: unknown) => unknown)(node.props));
  }

  return node;
}

/** React elements only: a `null` child, a string or a plain value carries no component to expand. */
function isElement(node: unknown): node is Node {
  return typeof node === 'object' && node !== null && 'props' in node && 'type' in node;
}

/** The first element of `type` under `node`, props included: a composed node hides its primitive one level down. */
function firstOfType<T>(node: unknown, type: unknown): T | undefined {
  if (Array.isArray(node)) {
    const found = node.find((child) => firstOfType<T>(child, type) !== undefined);
    return found === undefined ? undefined : firstOfType<T>(found, type);
  }
  if (!isElement(node)) return undefined;
  if (node.type === type) return node.props as T;

  return Object.values(node.props)
    .map((value) => firstOfType<T>(value, type))
    .find(Boolean);
}

describe('/meditation/stats today progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchDayDone.mockResolvedValue([dayRow(10, 30)]);
  });

  it("states today's minutes against the goal and fills the bar to that share", async () => {
    const tree = await statsSections();

    expect(firstOfType<{ children: unknown }>(tree, StatusText)?.children).toBe(
      '10 of 30 minutes today',
    );

    const bar = firstOfType<{ value: number; label: string }>(tree, ProgressBar);
    expect(bar?.value).toBeCloseTo(33.3, 1);
    expect(bar?.label).toBe('Today: 10 of 30 minutes');
  });

  it('reads the day the same single-day call /meditation makes, for the day it already resolved', async () => {
    await statsSections();

    expect(mockedFetchDayDone).toHaveBeenCalledWith(TODAY, TODAY);
    expect(mockedGetToday).toHaveBeenCalledTimes(1);
  });

  it('sits above the window control, the order /pomodoro/stats uses', async () => {
    const [progress, filter] = await statsSections();

    expect(firstOfType(progress, ProgressBar)).toBeDefined();
    expect(firstOfType(filter, Segmented)).toBeDefined();
  });

  it('shows nothing when the day read fails, rather than inventing a target', async () => {
    mockedFetchDayDone.mockRejectedValue(new Error('service down'));
    const tree = await statsSections();

    expect(firstOfType(tree, StatusText)).toBeUndefined();
    expect(firstOfType(tree, ProgressBar)).toBeUndefined();
  });

  it('shows the minutes alone when no goal is set, with no bar and no division', async () => {
    mockedFetchDayDone.mockResolvedValue([dayRow(10, 0)]);
    const tree = await statsSections();

    expect(firstOfType<{ children: unknown }>(tree, StatusText)?.children).toBe('10 minutes today');
    expect(firstOfType(tree, ProgressBar)).toBeUndefined();
  });
});
