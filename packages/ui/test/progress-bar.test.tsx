import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../src/components/progress-bar';

function fillOf(container: HTMLElement): HTMLElement {
  const fill = container.querySelector<HTMLElement>('.ui-progress-fill');
  if (fill === null) throw new Error('ProgressBar rendered no fill');
  return fill;
}

describe('ProgressBar', () => {
  it('fills the track to the percent it was given', () => {
    const { container } = render(<ProgressBar value={50} label="Today: 15 of 30 minutes" />);

    expect(fillOf(container).style.width).toBe('50%');
  });

  it('clamps a negative percent to an empty bar', () => {
    const { container } = render(<ProgressBar value={-20} label="Today: 0 of 30 minutes" />);

    expect(fillOf(container).style.width).toBe('0%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps a percent past full to a full bar', () => {
    const { container } = render(<ProgressBar value={150} label="Today: 40 of 30 minutes" />);

    expect(fillOf(container).style.width).toBe('100%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('exposes progressbar semantics with the caller name and the full range', () => {
    render(<ProgressBar value={20} label="Today: 10 of 30 minutes" />);

    const bar = screen.getByRole('progressbar', { name: 'Today: 10 of 30 minutes' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
  });

  it('styles itself from tokens, importing no chart library', () => {
    const source = readFileSync(join(__dirname, '../src/components/progress-bar.tsx'), 'utf8');

    expect(source).not.toContain('recharts');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(source).not.toMatch(/rgba?\(/);
  });
});
