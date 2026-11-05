import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { BarChart, labelsThatFit, visibleTickIndexes } from '../src/components/bar-chart';
import type { BarChartBucket } from '../src/components/bar-chart';

const buckets: BarChartBucket[] = [
  { label: 'Mon', value: 20, target: 25 },
  { label: 'Tue', value: 30, target: 25 },
  { label: 'Wed', value: 10 },
];

function plottedBuckets(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('path.recharts-rectangle'));
}

function targetRuns(container: HTMLElement): { left: number; right: number; height: number }[] {
  const line = container.querySelector('polyline.ui-bar-chart__target');
  if (line === null) return [];

  const points = (line.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((point) => point.split(',').map(Number));

  return points
    .filter((_, index) => index % 2 === 0)
    .map((start, run) => ({
      left: start[0],
      right: points[run * 2 + 1][0],
      height: start[1],
    }));
}

describe('BarChart', () => {
  it('draws one bar per bucket, taller for larger values', () => {
    const { container } = render(<BarChart data={buckets} label="Focus minutes per day" />);

    const bars = plottedBuckets(container);
    expect(bars).toHaveLength(buckets.length);

    const [monday, tuesday] = bars.map((bar) => Number(bar.getAttribute('height')));
    expect(tuesday).toBeGreaterThan(monday);
  });

  it('draws a bar at zero too, so an empty day never looks like missing data', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Mon', value: 0, target: 25 },
          { label: 'Tue', value: 30, target: 25 },
          { label: 'Wed', value: 0 },
        ]}
        label="Focus minutes per day"
      />,
    );

    const bars = plottedBuckets(container);
    expect(bars).toHaveLength(3);

    const [emptyMonday, , emptyWednesday] = bars.map((bar) => Number(bar.getAttribute('height')));
    expect(emptyMonday).toBeGreaterThan(0);
    expect(emptyWednesday).toBeGreaterThan(0);
  });

  it('carries every measured bar in the accent token, and an empty one in the muted chart tone', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Mon', value: 0 },
          { label: 'Tue', value: 30 },
        ]}
        label="Focus minutes per day"
      />,
    );

    const [emptyMonday, measuredTuesday] = plottedBuckets(container).map((bar) =>
      bar.getAttribute('fill'),
    );
    expect(emptyMonday).toBe('var(--chart-muted)');
    expect(measuredTuesday).toBe('var(--max)');
  });

  it('draws one flat target run per targeted bucket, and none for a bare bucket', () => {
    const { container } = render(<BarChart data={buckets} label="Focus minutes per day" />);

    const runs = targetRuns(container);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.left < run.right)).toBe(true);
  });

  it('raises the target run of a higher goal above a lower one', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Mon', value: 5, target: 5 },
          { label: 'Tue', value: 5, target: 20 },
        ]}
        label="Focus minutes per day"
      />,
    );

    const [lowGoal, highGoal] = targetRuns(container);
    expect(highGoal.height).toBeLessThan(lowGoal.height);
  });

  it('writes every y-axis tick in one number format, leading zero kept', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Mon', value: 0 },
          { label: 'Tue', value: 1 },
        ]}
        label="Focus minutes per day"
      />,
    );

    const yTicks = Array.from(
      container.querySelectorAll(
        '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
      ),
    ).map((tick) => (tick.textContent ?? '').trim());

    expect(yTicks).toContain('0.25');
    for (const tick of yTicks) {
      expect(tick).toMatch(/^-?\d/);
    }
  });

  it('carries the target line, axis ticks and axis strokes in tokens', () => {
    const { container } = render(<BarChart data={buckets} label="Focus minutes per day" />);

    const targetLine = container.querySelector('polyline.ui-bar-chart__target');
    expect(targetLine?.getAttribute('stroke')).toBe('var(--warn)');

    const tickTexts = Array.from(
      container.querySelectorAll('.recharts-cartesian-axis-tick-value'),
    );
    expect(tickTexts.length).toBeGreaterThan(0);
    for (const tick of tickTexts) {
      expect(tick.getAttribute('fill')).toBe('var(--ink-2)');
    }

    const axisLines = Array.from(container.querySelectorAll('.recharts-cartesian-axis-line'));
    expect(axisLines.length).toBeGreaterThan(0);
    for (const axis of axisLines) {
      expect(axis.getAttribute('stroke')).toBe('var(--line)');
    }
  });

  it('holds no colour literal in its source', () => {
    const source = readFileSync(join(__dirname, '../src/components/bar-chart.tsx'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(source).not.toMatch(/rgba?\(/);
  });

  it('pairs role="img" and an accessible name with a visually-hidden bucket list', () => {
    render(<BarChart data={buckets} label="Focus minutes per day" />);

    expect(screen.getByRole('img', { name: 'Focus minutes per day' })).toBeTruthy();

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['Mon: 20 of 25', 'Tue: 30 of 25', 'Wed: 10']);

    for (const item of screen.getAllByRole('listitem')) {
      expect(item.closest('ul')?.className).toContain('sr-only');
    }
  });

  it('labels at most seven of thirty daily buckets, first and last among them', () => {
    const daily = Array.from({ length: 30 }, (_, day) => ({
      label: `Day ${day + 1}`,
      value: day,
    }));

    const { container } = render(<BarChart data={daily} label="Focus minutes per day" />);

    const labelled = Array.from(
      container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'),
    ).filter((tick) => (tick.textContent ?? '').trim() !== '');

    expect(labelled.length).toBeGreaterThanOrEqual(2);
    expect(labelled.length).toBeLessThanOrEqual(7);
    expect(labelled[0].textContent).toBe('Day 1');
    expect(labelled[labelled.length - 1].textContent).toBe('Day 30');
  });
});

describe('labelsThatFit', () => {
  it('asks for the full set of seven on a plot wide enough to hold them', () => {
    expect(labelsThatFit(600)).toBe(7);
  });

  it('asks for fewer labels as the plot narrows, so neighbours stop touching', () => {
    const phoneWidth = labelsThatFit(317);

    expect(phoneWidth).toBeLessThan(7);
    expect(phoneWidth).toBeGreaterThanOrEqual(2);
    expect(labelsThatFit(200)).toBeLessThan(phoneWidth);
  });

  it('always keeps the two labels that mark the range', () => {
    expect(labelsThatFit(10)).toBe(2);
  });

  it('asks for the cap before recharts has measured the plot', () => {
    expect(labelsThatFit(undefined)).toBe(7);
  });
});

describe('visibleTickIndexes', () => {
  it('keeps first and last of thirty buckets and labels at most seven', () => {
    const indexes = visibleTickIndexes(30, 7);

    expect(indexes).toHaveLength(7);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(29);
    expect(new Set(indexes).size).toBe(7);
  });

  it('labels every bucket when the chart has room for them', () => {
    expect(visibleTickIndexes(5, 7)).toEqual([0, 1, 2, 3, 4]);
  });

  it('asks for no ticks when there is nothing to draw', () => {
    expect(visibleTickIndexes(0, 7)).toEqual([]);
  });

  it('drops every label whose band is narrower than a label, keeping the range ends', () => {
    // 375 px week view: 7 buckets, 5 requested labels, ~40.7 px bands, 54 px of label.
    const indexes = visibleTickIndexes(7, 5, 40.7);

    expect(indexes).toEqual([0, 2, 4, 6]);
    for (let at = 1; at < indexes.length; at += 1) {
      expect(indexes[at] - indexes[at - 1]).toBeGreaterThan(1);
    }
  });
});
