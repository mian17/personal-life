'use client';

import type { BarShapeProps, ScaleFunction } from 'recharts';
import {
  Bar,
  BarChart as RechartsBarChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from 'recharts';

export interface BarChartBucket {
  /** Tick text and screen-reader name for one bucket, e.g. `"Mon"`. */
  label: string;
  /** What the bucket measured, in minutes. */
  value: number;
  /** What the bucket aimed for, when it aimed for something. */
  target?: number;
}

export interface BarChartProps {
  data: BarChartBucket[];
  /** Accessible name for the whole chart, e.g. `"Focus minutes per day"`. */
  label: string;
  /** Height in pixels; the chart takes its container's width. */
  height?: number;
}

/** One plotted bucket: recharts reads the bar's value and the target line's goal off it. */
interface ChartRow {
  index: number;
  value: number;
  target?: number;
}

const DEFAULT_HEIGHT = 160;

/** The most labels a phone-width plot ever carries; `labelsThatFit` trims below it. */
const MAX_LABELLED_TICKS = 7;

/** Width of the longest tick text worth allowing for, e.g. `"Day 30"` at the axis font size. */
const LABEL_WIDTH = 48;

/** Breathing room between two neighbouring labels, so they read as separate ticks. */
const LABEL_GAP = 6;

/**
 * Room for the widest y tick (`"0.25"`, ~34px) plus the axis's own `tickSize` and
 * `tickMargin`. The plot clips at its left edge, so a narrower axis cuts off the leading
 * glyph and reads as a second number format (`.25` beside `0.5`).
 */
const Y_AXIS_WIDTH = 44;

/**
 * Plot margins: the right side holds the final tick's half-label, which recharts centres on
 * the last band and would otherwise cut off at the plot edge.
 */
const PLOT_MARGIN = { top: 4, right: 26, bottom: 0, left: 0 };

/** A zero-minute bucket still draws a hairline, so an empty day never looks like missing data. */
const EMPTY_BAR_HEIGHT = 2;

/**
 * The wrapper around recharts — its only home in the repository. Bars carry the
 * measured minutes, one stepped `ReferenceLine` carries the per-bucket targets, and
 * every colour arrives as a `var(--…)` token so a theme change moves the chart.
 *
 * §8 draws the bars square-cornered, and a bucket with nothing in it in the muted chart tone
 * rather than the accent — that is what tells an empty day apart from a missing one.
 */
export function BarChart({ data, label, height = DEFAULT_HEIGHT }: Readonly<BarChartProps>) {
  const rows = data.map((bucket, index) => ({
    index,
    value: bucket.value,
    target: bucket.target,
  }));

  return (
    <div className="ui-bar-chart">
      <div role="img" aria-label={label} className="ui-bar-chart__plot" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
          <RechartsBarChart data={rows} margin={PLOT_MARGIN}>
            <BucketAxis buckets={data} count={rows.length} />
            <YAxis
              width={Y_AXIS_WIDTH}
              domain={[0, tallestAmount(rows)]}
              tick={{ fill: 'var(--ink-2)' }}
              stroke="var(--line)"
            />
            {hasTargets(rows) && (
              <ReferenceLine
                y={0}
                ifOverflow="hidden"
                stroke="var(--warn)"
                strokeDasharray="4 4"
                shape={<TargetSteps rows={rows} />}
              />
            )}
            <Bar
              dataKey="value"
              minPointSize={EMPTY_BAR_HEIGHT}
              isAnimationActive={false}
              shape={BucketBar}
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
      <BucketList buckets={data} />
    </div>
  );
}

/**
 * One bar: recharts' own rectangle, filled from the bucket's token. `Cell` is deprecated in
 * recharts 3 and removed in 4, so the per-bucket fill rides the series' `shape` instead — the
 * same `Rectangle` the chart draws by default, given the fill its bucket earns.
 */
function BucketBar({ x, y, width, height, value }: BarShapeProps) {
  // An SVG `fill` cannot name a Tailwind colour utility, so it reads the token directly: `--max`
  // is declared in the app's scope, which this chart sits inside, so the bar takes the app's
  // accent in both schemes the way `bg-max` does in the markup around it. A zero bucket keeps
  // the muted chart tone.
  const fill = value === 0 ? 'var(--chart-muted)' : 'var(--max)';
  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} />;
}

/**
 * The x-axis: it labels only the buckets the plot has room for, so a month of daily bars
 * stays legible without a tick sliding under its neighbour.
 */
function BucketAxis({ buckets, count }: Readonly<{ buckets: BarChartBucket[]; count: number }>) {
  const plotArea = usePlotArea();
  const bandWidth = plotArea === undefined || count === 0 ? undefined : plotArea.width / count;
  const labelledIndexes = new Set(
    visibleTickIndexes(count, labelsThatFit(plotArea?.width), bandWidth),
  );

  return (
    <XAxis
      dataKey="index"
      interval={0}
      tickFormatter={tickLabel(buckets, labelledIndexes)}
      tick={{ fill: 'var(--ink-2)' }}
      stroke="var(--line)"
    />
  );
}

/**
 * How many labels this plot can carry side by side: the band gap a label needs, capped at
 * `MAX_LABELLED_TICKS` and floored at the two that mark the range. An unmeasured plot asks
 * for the cap, and settles to the real count once recharts has measured it.
 */
export function labelsThatFit(plotWidth: number | undefined): number {
  if (plotWidth === undefined) return MAX_LABELLED_TICKS;

  const labels = Math.floor(plotWidth / (LABEL_WIDTH + LABEL_GAP));
  return Math.min(MAX_LABELLED_TICKS, Math.max(2, labels));
}

/**
 * The bucket indexes that earn a tick label: at most `maxTicks` labels, first and last
 * always among them so the range a reader sees is exact, and no two closer than one
 * label needs — rounded picks alone can land two labels on neighbouring bands, which
 * overprints at 375 px.
 */
export function visibleTickIndexes(
  count: number,
  maxTicks: number,
  bandWidth?: number,
): number[] {
  if (count <= 0 || maxTicks <= 0) return [];
  if (maxTicks === 1) return [0];

  const lastIndex = count - 1;
  const bandsApart = bandWidth === undefined || bandWidth <= 0
    ? 1
    : Math.max(1, Math.ceil((LABEL_WIDTH + LABEL_GAP) / bandWidth));
  const ticks = Math.min(maxTicks, Math.floor(lastIndex / bandsApart) + 1);
  if (ticks <= 1) return [0];

  const gap = lastIndex / (ticks - 1);

  return Array.from({ length: ticks }, (_, tick) => Math.round(tick * gap));
}

/** Names the ticks `visibleTickIndexes` picked, blanking every other tick's text. */
function tickLabel(buckets: BarChartBucket[], labelledIndexes: Set<number>) {
  return (tickIndex: number) => (labelledIndexes.has(tickIndex) ? (buckets[tickIndex]?.label ?? '') : '');
}

function hasTargets(rows: ChartRow[]): boolean {
  return rows.some((row) => row.target !== undefined);
}

/** Top of the value axis: bars and targets both have to fit inside it. */
function tallestAmount(rows: ChartRow[]): number {
  const amounts = rows.flatMap((row) =>
    row.target === undefined ? [row.value] : [row.value, row.target],
  );

  return Math.max(1, ...amounts);
}

/**
 * The stepped target line: one flat run across each targeted bucket's band, raised or
 * lowered to that bucket's goal, so a reader sees every bucket's aim at its own bar.
 */
function TargetSteps({ rows }: Readonly<{ rows: ChartRow[] }>) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  const runs = rows.flatMap((row) =>
    row.target === undefined ? [] : targetRun(row, { x: xScale, y: yScale }),
  );

  if (runs.length === 0) return null;

  return (
    <polyline
      className="ui-bar-chart__target"
      fill="none"
      stroke="var(--warn)"
      strokeDasharray="4 4"
      points={runs.join(' ')}
    />
  );
}

/** The two axis scales a target run is drawn against. */
interface ChartScales {
  x: ScaleFunction | undefined;
  y: ScaleFunction | undefined;
}

/** One bucket's flat run: its band's left edge to its right edge, at the goal's height. */
function targetRun(row: ChartRow, scales: ChartScales): string[] {
  if (row.target === undefined) return [];

  const left = scales.x?.(row.index, { position: 'start' });
  const right = scales.x?.(row.index, { position: 'end' });
  const height = scales.y?.(row.target);

  if (left === undefined || right === undefined || height === undefined) return [];

  return [`${left},${height} ${right},${height}`];
}

/** The chart's data as text, so a screen reader hears the numbers the bars draw. */
function BucketList({ buckets }: Readonly<{ buckets: BarChartBucket[] }>) {
  return (
    <ul className="ui-bar-chart__buckets sr-only">
      {buckets.map((bucket) => (
        <li key={bucket.label}>{describeBucket(bucket)}</li>
      ))}
    </ul>
  );
}

function describeBucket(bucket: BarChartBucket): string {
  return bucket.target === undefined
    ? `${bucket.label}: ${bucket.value}`
    : `${bucket.label}: ${bucket.value} of ${bucket.target}`;
}
