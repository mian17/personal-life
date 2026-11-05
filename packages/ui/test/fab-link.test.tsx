import { render, screen } from '@testing-library/react';
import { FabLink } from '../src/components/fab-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const FAB_SIZE_UTILITY = 'size-[var(--fab-size)]';
const FAB_RADIUS_UTILITY = 'rounded-full';

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

  it('routes through next/link rather than a bare anchor', () => {
    render(
      <FabLink href="/notes/new" label="New note">
        <span />
      </FabLink>,
    );
    expect(screen.getByRole('link').hasAttribute('data-next-link')).toBe(true);
  });

  it('carries the ui-fab-link hook alongside the registry button shape', () => {
    render(
      <FabLink href="/" label="Add">
        {<span />}
      </FabLink>,
    );
    const link = screen.getByRole('link');
    expect(classesOf(link)).toContain('ui-fab-link');
    expect(link.classList.contains('bg-max')).toBe(true);
    expect(link.classList.contains('text-on-max')).toBe(true);
  });

  it('expresses the fab size through utilities rather than the --fab-size rule', () => {
    render(
      <FabLink href="/" label="Add">
        {<span />}
      </FabLink>,
    );
    const classes = classesOf(screen.getByRole('link'));
    expect(classes).toContain(FAB_SIZE_UTILITY);
    expect(classes).toContain(FAB_RADIUS_UTILITY);
  });

  it('merges className instead of replacing it', () => {
    render(
      <FabLink href="/" label="Add" className="legacy-hook">
        {<span />}
      </FabLink>,
    );
    const classes = classesOf(screen.getByRole('link'));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-fab-link');
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
