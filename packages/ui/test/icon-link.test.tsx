import { render, screen } from '@testing-library/react';
import { IconLink } from '../src/components/icon-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('IconLink', () => {
  it('renders an anchor (never a button) with the label as its aria-label', () => {
    render(
      <IconLink href="/trash" label="Trash">
        <span data-testid="icon" />
      </IconLink>,
    );
    const link = screen.getByRole('link', { name: 'Trash' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/trash');
    expect(link.getAttribute('aria-label')).toBe('Trash');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders its children (the icon) inside the anchor', () => {
    render(
      <IconLink href="/" label="Back">
        <span data-testid="icon" />
      </IconLink>,
    );
    expect(screen.getByRole('link', { name: 'Back' }).contains(screen.getByTestId('icon'))).toBe(
      true,
    );
  });

  it('carries the ui-icon-link hook alongside the icon control square', () => {
    render(<IconLink href="/" label="Back">{<span />}</IconLink>);
    const link = screen.getByRole('link');
    expect(link.classList.contains('ui-icon-link')).toBe(true);
    expect(link.classList.contains('size-[var(--tap)]')).toBe(true);
    expect(link.classList.contains('rounded-[var(--r-md)]')).toBe(true);
    expect(link.classList.contains('bg-surface')).toBe(true);
  });

  it('paints through the current vocabulary and never a retired alias', () => {
    render(<IconLink href="/" label="Back">{<span />}</IconLink>);
    const classes = classesOf(screen.getByRole('link'));

    expect(classes).toEqual(
      expect.arrayContaining([
        'border-line',
        'bg-surface',
        'text-ink',
        'active:bg-press',
        'focus-visible:outline-focus',
      ]),
    );
    for (const retired of [
      'border-border',
      'bg-panel',
      'text-text',
      'outline-accent',
      'size-10',
      'rounded-md',
    ]) {
      expect(classes).not.toContain(retired);
    }
  });

  it('merges className instead of replacing it', () => {
    render(
      <IconLink href="/" label="Back" className="legacy-hook">
        {<span />}
      </IconLink>,
    );
    const link = screen.getByRole('link');
    expect(classesOf(link)).toContain('legacy-hook');
    expect(link.classList.contains('ui-icon-link')).toBe(true);
  });

  it('keeps the accessible name verbatim', () => {
    render(<IconLink href="/" label="Go home">{<span />}</IconLink>);
    expect(screen.getByRole('link').getAttribute('aria-label')).toBe('Go home');
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<IconLink href="/" label="Back">{<span />}</IconLink>);
    const link = screen.getByRole('link');
    expect(link.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(link.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
  });
});
