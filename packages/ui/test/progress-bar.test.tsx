import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../src/components/progress-bar';

/** The rendered bar's own `value`, the number the element actually draws from. */
function drawnPercent(bar: HTMLElement): number {
  return Number(bar.getAttribute('value'));
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

  it('styles itself from tokens, importing no chart library', () => {
    const source = readFileSync(join(__dirname, '../src/components/progress-bar.tsx'), 'utf8');

    expect(source).not.toContain('recharts');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(source).not.toMatch(/rgba?\(/);
  });
});
