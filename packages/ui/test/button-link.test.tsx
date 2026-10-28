import { render, screen } from '@testing-library/react';
import { ButtonLink } from '../src/components/button-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function expectHook(link: Element, hook: string) {
  expect(link.classList.contains(hook)).toBe(true);
}

describe('ButtonLink', () => {
  it('renders an anchor (never a button) carrying the button visuals by default', () => {
    render(<ButtonLink href="/meals/saved">Saved meals</ButtonLink>);
    const link = screen.getByRole('link', { name: 'Saved meals' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/meals/saved');
    expect(screen.queryByRole('button')).toBeNull();
    expectHook(link, 'ui-btn');
    expectHook(link, 'ui-btn--default');
    expectHook(link, 'ui-btn--primary');
    expect(link.getAttribute('data-next-link')).toBe('');
  });

  it('honors variant and size props on the same anchor', () => {
    render(
      <ButtonLink href="/meals/saved" variant="ghost" size="bare">
        Saved meals
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Saved meals' });
    expect(link.tagName).toBe('A');
    expectHook(link, 'ui-btn');
    expectHook(link, 'ui-btn--bare');
    expectHook(link, 'ui-btn--ghost');
  });

  it('carries the registry button geometry of the requested size', () => {
    render(
      <ButtonLink href="/" size="bare">
        Go
      </ButtonLink>,
    );
    const link = screen.getByRole('link');
    expect(link.classList.contains('h-auto')).toBe(true);
    expect(link.classList.contains('bg-accent')).toBe(true);
    expect(link.classList.contains('text-on-accent')).toBe(true);
  });

  it('suppresses the anchor underline', () => {
    render(<ButtonLink href="/">Go</ButtonLink>);
    expect(screen.getByRole('link').classList.contains('no-underline')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <ButtonLink href="/" className="legacy-hook">
        Go
      </ButtonLink>,
    );
    const link = screen.getByRole('link');
    expect(classesOf(link)).toContain('legacy-hook');
    expectHook(link, 'ui-btn');
  });
});
