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

  it('uses only the ui-icon-link class by default', () => {
    render(<IconLink href="/" label="Back">{<span />}</IconLink>);
    expect(classesOf(screen.getByRole('link'))).toEqual(['ui-icon-link']);
  });

  it('merges className instead of replacing it', () => {
    render(
      <IconLink href="/" label="Back" className="legacy-hook">
        {<span />}
      </IconLink>,
    );
    expect(classesOf(screen.getByRole('link'))).toEqual(['legacy-hook', 'ui-icon-link']);
  });

  it('keeps the accessible name verbatim', () => {
    render(<IconLink href="/" label="Go home">{<span />}</IconLink>);
    expect(screen.getByRole('link').getAttribute('aria-label')).toBe('Go home');
  });
});
