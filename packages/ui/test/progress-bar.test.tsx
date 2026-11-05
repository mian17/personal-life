import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../src/components/progress-bar';

/** The rendered bar's own `value`, the number the element actually draws from. */
function drawnPercent(bar: HTMLElement): number {
  return Number(bar.getAttribute('value'));
}

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

describe('ProgressBar', () => {
  it('fills the track to the percent it was given', () => {
    render(<ProgressBar value={50} label="Today: 15 of 30 minutes" />);

    expect(drawnPercent(screen.getByRole('progressbar'))).toBe(50);
  });

  it('clamps a negative percent to an empty bar', () => {
    render(<ProgressBar value={-20} label="Today: 0 of 30 minutes" />);

    const bar = screen.getByRole('progressbar');
    expect(drawnPercent(bar)).toBe(0);
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps a percent past full to a full bar', () => {
    render(<ProgressBar value={150} label="Today: 40 of 30 minutes" />);

    const bar = screen.getByRole('progressbar');
    expect(drawnPercent(bar)).toBe(100);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('exposes progressbar semantics with the caller name and the full range', () => {
    render(<ProgressBar value={20} label="Today: 10 of 30 minutes" />);

    const bar = screen.getByRole('progressbar', { name: 'Today: 10 of 30 minutes' });
    expect(bar.tagName).toBe('PROGRESS');
    expect(bar.getAttribute('max')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
  });

  it('draws its caption above the bar, without adding a second read-out role', () => {
    render(<ProgressBar value={52} label="62 g of protein toward 120 g" caption="Protein · 62 / 120 g" />);

    expect(screen.getByText('Protein · 62 / 120 g')).toBeDefined();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(drawnPercent(screen.getByRole('progressbar'))).toBe(52);
  });

  it('draws the reference macro row: label, track and read-out on one grid line', () => {
    const { container } = render(
      <ProgressBar
        value={52}
        label="62 grams of protein toward 120"
        caption="Protein"
        readout="62 / 120 g"
      />,
    );

    const row = container.firstElementChild as HTMLElement;
    expect(classesOf(row)).toEqual(
      expect.arrayContaining(['ui-progress--row', 'items-center', 'gap-[var(--s3)]']),
    );
    // §8's `.macro`: the label column, the track, then the read-out column.
    expect(classesOf(row)).toContain('grid-cols-[calc(var(--s4)*4)_1fr_calc(var(--s2)*11)]');

    const [label, bar, readout] = Array.from(row.children) as HTMLElement[];
    expect(label.textContent).toBe('Protein');
    expect(classesOf(label)).toEqual(
      expect.arrayContaining([
        'ui-progress__caption',
        'text-[length:var(--fs-label)]',
        'font-semibold',
      ]),
    );
    expect(bar.tagName).toBe('PROGRESS');
    expect(bar.getAttribute('aria-label')).toBe('62 grams of protein toward 120');
    expect(readout.textContent).toBe('62 / 120 g');
    expect(classesOf(readout)).toEqual(
      expect.arrayContaining(['ui-progress__readout', 'text-ink-2', 'text-right', 'tabular-nums']),
    );
  });

  it('ignores a read-out with no label to sit against, drawing the bare bar', () => {
    render(<ProgressBar value={40} label="Today: 12 of 30 minutes" readout="12 / 30 min" />);

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByText('12 / 30 min')).toBeNull();
  });

  it('keeps the pressed trough by default and takes the reference hairline on request', () => {
    const { container: pressed } = render(<ProgressBar value={10} label="Today: 3 of 30 minutes" />);
    expect(classesOf(pressed.firstElementChild as HTMLElement)).toContain('bg-press');

    const { container: hairline } = render(
      <ProgressBar value={10} label="No daily energy target set" tone="line" />,
    );
    const trough = classesOf(hairline.firstElementChild as HTMLElement);
    expect(trough).toContain('bg-line');
    expect(trough).not.toContain('bg-press');
  });

  it('styles itself from tokens, importing no chart library', () => {
    const source = readFileSync(join(__dirname, '../src/components/progress-bar.tsx'), 'utf8');

    expect(source).not.toContain('recharts');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(source).not.toMatch(/rgba?\(/);
  });
});
