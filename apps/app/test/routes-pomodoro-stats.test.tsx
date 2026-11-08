import type { ReactElement } from 'react';
import * as ui from '@life/ui';
import {
  BarChart,
  IconLink,
  ManagerBlock,
  ProgressBar,
  Section,
  Segmented,
  StatusText,
} from '@life/ui';
import type { Segment } from '@life/ui';

// The route is a thin server shell over three seams: the BFF rows, the caller's
// `today`, and the pure window arithmetic (the `routes-matrix.test.tsx` pattern).
// The bucketing itself is proven in `stats-buckets.test.ts`.
jest.mock('@/lib/focus-api', () => ({
  listSessions: jest.fn(),
  listGoals: jest.fn(),
}));
jest.mock('@/lib/today', () => ({
  getToday: jest.fn(),
}));

import { listGoals, listSessions, type SessionRow } from '@/lib/focus-api';
import { getToday } from '@/lib/today';
import PomodoroStatsRoute from '@/app/pomodoro/stats/page';
import { StatsView } from '@/app/pomodoro/stats/stats-view';

const mockedListSessions = listSessions as jest.MockedFunction<typeof listSessions>;
const mockedListGoals = listGoals as jest.MockedFunction<typeof listGoals>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

const TODAY = '2026-10-28';

/** Every `@life/ui` primitive by value, so a walk below expands app components and stops at primitives. */
const PRIMITIVES = new Set<unknown>(Object.values(ui));

function sessionOn(date: string, minutes: number): SessionRow {
  return {
    id: `s-${date}`,
    ownerSub: 'owner-1',
    date,
    minutes,
    createdAt: `${date}T09:00:00.000Z`,
  };
}

/** The route as the page hands it to the view. */
async function statsPage(searchParams: { period?: string; offset?: string }) {
  return PomodoroStatsRoute({ searchParams: Promise.resolve(searchParams) });
}

/**
 * The route's output with the app's own components expanded into the primitives
 * they return, so a test can assert what the owner sees without mounting anything.
 */
function statsTree(page: ReactElement<{ children?: unknown }>): unknown {
  const view = findByType(page, StatsView);
  if (!view) throw new Error('no StatsView rendered');
  return expandAppComponents(view);
}

function expandAppComponents(node: unknown): unknown {
  if (Array.isArray(node)) return node.flatMap(expandAppComponents);
  if (!isElement(node)) return node;

  const el = node as ReactElement<Record<string, unknown>>;
  if (!PRIMITIVES.has(el.type) && typeof el.type === 'function') {
    return expandAppComponents((el.type as (props: unknown) => unknown)(el.props));
  }

  const expandedProps = Object.fromEntries(
    Object.entries(el.props).map(([name, value]) => [name, expandAppComponents(value)]),
  );
  return { ...el, props: expandedProps };
}

/** React elements only: a plain value (a chart bucket, a string) carries no component to expand. */
function isElement(node: unknown): boolean {
  return typeof node === 'object' && node !== null && 'props' in node && 'type' in node;
}

/** The first element of `type` anywhere under `node`, props included, optionally matching `match`. */
function findByType(
  node: unknown,
  type: unknown,
  match?: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  return findAllOfType(node, type, match)[0];
}

/**
 * Every element of `type` under `node`, in document order. Props count as part of
 * the tree here: an `actions` slot is where a composed control lives, and a walk
 * that only followed `children` would report its container as empty.
 */
function findAllOfType(
  node: unknown,
  type: unknown,
  match?: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAllOfType(child, type, match));
  if (!isElement(node)) return [];

  const el = node as ReactElement<Record<string, unknown>>;
  const self = el.type === type && (!match || match(el)) ? [el] : [];
  const nested = Object.values(el.props).flatMap((value) => findAllOfType(value, type, match));
  return [...self, ...nested];
}

function withType<T>(tree: unknown, type: unknown): T {
  const el = findByType(tree, type);
  if (!el) throw new Error(`no ${String(type)} rendered`);
  return el.props as unknown as T;
}

/** The href the one shift control points at. */
function shiftHref(tree: unknown): string {
  return withType<{ href: string }>(tree, IconLink).href;
}

/** The chart-window control's segments, in render order. */
function segments(tree: unknown): Segment[] {
  return withType<{ items: Segment[] }>(tree, Segmented).items;
}

/** The dashed-line note's text, or `undefined` when no goal resolves for today. */
function goalNote(tree: unknown): string | undefined {
  return findAllOfType(tree, 'p')[0]?.props.children as string | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetToday.mockResolvedValue(TODAY);
  mockedListSessions.mockResolvedValue([sessionOn(TODAY, 20)]);
  mockedListGoals.mockResolvedValue([{ validFrom: '2026-01-01', minutes: 30 }]);
});

describe('/pomodoro/stats page wiring', () => {
  it('renders today at 67 percent of a 30-minute goal, with the minutes in the label', async () => {
    const tree = statsTree(await statsPage({}));
    const bar = withType<{ value: number; label: string }>(tree, ProgressBar);

    expect(bar.value).toBeCloseTo(66.7, 1);
    expect(bar.label).toBe('Today: 20 of 30 minutes');
  });

  it('reads an absent or unknown period as the week segment and a junk offset as today', async () => {
    const tree = statsTree(await statsPage({ period: 'nonsense', offset: '-3' }));

    expect(segments(tree).find((item) => item.active)?.label).toBe('Week');
    expect(shiftHref(tree)).toBe('/pomodoro/stats?period=week&offset=1');
  });
});

describe('/pomodoro/stats today bar with no goal', () => {
  beforeEach(() => {
    mockedListGoals.mockResolvedValue([]);
  });

  it('states the minutes alone, claiming no percentage and drawing no target line', async () => {
    const tree = statsTree(await statsPage({}));

    expect(findByType(tree, ProgressBar)).toBeUndefined();
    expect(withType<{ children: unknown }>(tree, StatusText).children).toBe('20 minutes today');

    const { data } = withType<{ data: { target?: number }[] }>(tree, BarChart);
    expect(data.every((bucket) => bucket.target === undefined)).toBe(true);
    expect(goalNote(tree)).toBeUndefined();
  });
});

describe('/pomodoro/stats trend window', () => {
  it('draws 7 daily bars for a week, 30 for a month, 12 monthly bars for a year', async () => {
    const counts = await Promise.all(
      (['week', 'month', 'year'] as const).map(async (period) => {
        const tree = statsTree(await statsPage({ period }));
        return [period, withType<{ data: unknown[] }>(tree, BarChart).data.length];
      }),
    );

    expect(Object.fromEntries(counts)).toEqual({ week: 7, month: 30, year: 12 });
  });

  it('carries each bar the target its day resolves to', async () => {
    const tree = statsTree(await statsPage({ period: 'week' }));
    const { data } = withType<{ data: { value: number; target?: number }[] }>(tree, BarChart);

    expect(data.map((bucket) => bucket.target)).toEqual(Array(7).fill(30));
    expect(data.at(-1)).toMatchObject({ value: 20, target: 30 });
  });

  it('points the shift control one period further back, keeping the period', async () => {
    expect(shiftHref(statsTree(await statsPage({ period: 'month' })))).toBe(
      '/pomodoro/stats?period=month&offset=1',
    );
    expect(shiftHref(statsTree(await statsPage({ period: 'month', offset: '2' })))).toBe(
      '/pomodoro/stats?period=month&offset=3',
    );
  });

  it('fetches the shifted window plus today, so today stays measured inside it', async () => {
    const tree = statsTree(await statsPage({ period: 'week', offset: '1' }));
    const { data } = withType<{ data: { value: number }[] }>(tree, BarChart);

    expect(data.at(-1)?.value).toBe(0);
    expect(withType<{ label: string }>(tree, ProgressBar).label).toBe('Today: 20 of 30 minutes');
    expect(mockedListSessions).toHaveBeenCalledWith('2026-10-15', TODAY);
  });

  it('clamps a hand-typed huge offset to the oldest window and still renders it', async () => {
    const tree = statsTree(await statsPage({ period: 'week', offset: '1000000' }));

    expect(withType<{ data: unknown[] }>(tree, BarChart).data).toHaveLength(7);
    expect(mockedListSessions).toHaveBeenCalledWith('2016-11-03', TODAY);
  });

  it('names the chart by what one bar covers', async () => {
    const week = statsTree(await statsPage({ period: 'week' }));
    const year = statsTree(await statsPage({ period: 'year' }));

    expect(withType<{ label: string }>(week, BarChart).label).toBe('Focus minutes per day');
    expect(withType<{ label: string }>(year, BarChart).label).toBe('Focus minutes per month');
  });
});

describe('/pomodoro/stats composition', () => {
  it('is a manager block titled Stats, backed to the timer', async () => {
    const tree = statsTree(await statsPage({}));
    const block = withType<{ title: string; backHref: string }>(tree, ManagerBlock);

    expect(block.title).toBe('Stats');
    expect(block.backHref).toBe('/pomodoro');
  });

  it('states the window total at the section heading and the goal the dashed line means', async () => {
    const tree = statsTree(await statsPage({}));
    const section = withType<{ label: string; count: string }>(tree, Section);

    expect(section.label).toBe('Focus minutes');
    // Today's 20 minutes inside a 7-day window whose other days hold nothing.
    expect(section.count).toBe('20 min');
    expect(goalNote(tree)).toBe('Dashed line is the 30 minute daily goal.');
  });

  it('filters the period through one segment per period, each resetting the window to today', async () => {
    const tree = statsTree(await statsPage({ period: 'month' }));

    expect(withType<{ 'aria-label': string }>(tree, Segmented)['aria-label']).toBe('Chart window');
    expect(segments(tree).map(({ label, href }) => [label, href])).toEqual([
      ['Week', '/pomodoro/stats?period=week'],
      ['Month', '/pomodoro/stats?period=month'],
      ['Year', '/pomodoro/stats?period=year'],
    ]);
    expect(segments(tree).filter((item) => item.active).map(({ label }) => label)).toEqual([
      'Month',
    ]);
  });
});
