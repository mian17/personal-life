import { render, screen } from '@testing-library/react';
import { FabLink } from '../src/components/fab-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('FabLink', () => {
  it('renders an anchor (never a button) with href and label as its aria-label', () => {
    render(
      <FabLink href="/notes/new" label="New note">
        <span data-testid="icon" />
      </FabLink>,
    );
    const link = screen.getByRole('link', { name: 'New note' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/notes/new');
    expect(link.getAttribute('aria-label')).toBe('New note');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders its children (the icon) inside the anchor', () => {
    render(
      <FabLink href="/notes/new" label="New note">
        <span data-testid="icon" />
      </FabLink>,
    );
    expect(screen.getByRole('link').contains(screen.getByTestId('icon'))).toBe(true);
  });

  it('uses the ui-fab-link class', () => {
    render(
      <FabLink href="/" label="Add">
        {<span />}
      </FabLink>,
    );
    expect(classesOf(screen.getByRole('link'))).toEqual(['ui-fab-link']);
  });

  it('merges className instead of replacing it', () => {
    render(
      <FabLink href="/" label="Add" className="legacy-hook">
        {<span />}
      </FabLink>,
    );
    expect(classesOf(screen.getByRole('link'))).toEqual(['legacy-hook', 'ui-fab-link']);
  });

  it('keeps the accessible name verbatim', () => {
    render(
      <FabLink href="/" label="Create a fresh note">
        {<span />}
      </FabLink>,
    );
    expect(screen.getByRole('link').getAttribute('aria-label')).toBe('Create a fresh note');
  });
});
