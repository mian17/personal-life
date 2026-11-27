import { render, screen } from '@testing-library/react';
import { Caption } from '../src/components/caption';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

describe('Caption', () => {
  it('renders a plain paragraph with no role and no tab stop', () => {
    render(<Caption>Meditation · 10 min</Caption>);

    const line = screen.getByText('Meditation · 10 min');
    expect(line.tagName).toBe('P');
    expect(line.hasAttribute('role')).toBe(false);
    expect(line.hasAttribute('tabindex')).toBe(false);
  });

  it('defaults to the label tier: section-label tracking, never uppercased', () => {
    render(<Caption>minutes sat</Caption>);

    const classes = classesOf(screen.getByText('minutes sat'));
    expect(classes).toContain('text-[length:var(--fs-label)]');
    expect(classes).toContain('tracking-[var(--tracking-section-label)]');
    expect(classes).toContain('text-ink-2');
    expect(classes).not.toContain('uppercase');
  });

  it('selects the meta tier without the label tracking', () => {
    render(<Caption size="meta">Bowl every 10 min, starting after 1 min, unlimited</Caption>);

    const classes = classesOf(screen.getByText(/Bowl every 10 min/));
    expect(classes).toContain('text-[length:var(--fs-meta)]');
    expect(classes).not.toContain('text-[length:var(--fs-label)]');
    expect(classes).not.toContain('tracking-[var(--tracking-section-label)]');
  });

  it('says nothing by default: a line that never rewrites must not announce', () => {
    render(<Caption>minutes sat</Caption>);

    expect(screen.getByText('minutes sat').hasAttribute('aria-live')).toBe(false);
  });

  it('opts into a polite live region for the one line that rewrites', () => {
    render(
      <Caption size="meta" live>
        Bowl every 10 min, starting after 1 min, unlimited
      </Caption>,
    );

    const line = screen.getByText(/Bowl every 10 min/);
    expect(line.getAttribute('aria-live')).toBe('polite');
    // A caption that happens to change is not a status.
    expect(line.hasAttribute('role')).toBe(false);
  });
});
