import { render, screen } from '@testing-library/react';
import { TagFilterNav, type TagFilterItem } from '../src/components/tag-filter-nav';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('TagFilterNav', () => {
  it('renders a <nav> with the ui-tag-filter-nav class', () => {
    render(<TagFilterNav items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(nav.tagName).toBe('NAV');
    expect(nav.classList.contains('ui-tag-filter-nav')).toBe(true);
    expect(nav.children).toHaveLength(0);
  });

  it('carries the row geometry as utilities (the retired .ui-tag-filter-nav rule)', () => {
    render(<TagFilterNav items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(nav.classList.contains('flex')).toBe(true);
    expect(nav.classList.contains('flex-wrap')).toBe(true);
    expect(nav.classList.contains('items-baseline')).toBe(true);
    expect(nav.classList.contains('gap-[var(--space-0-5)]')).toBe(true);
  });

  it('renders one filter Pill anchor per item with the name verbatim as its accessible name', () => {
    const items: TagFilterItem[] = [
      { name: 'All', href: '/' },
      { name: 'errand', href: '/?tag=errand' },
    ];
    render(<TagFilterNav items={items} />);
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'errand' }).getAttribute('href')).toBe(
      '/?tag=errand',
    );
  });

  it('marks the active item through the Pill active modifier only', () => {
    const items: TagFilterItem[] = [
      { name: 'All', href: '/' },
      { name: 'errand', href: '/?tag=errand', active: true },
    ];
    render(<TagFilterNav items={items} />);
    expect(screen.getByRole('link', { name: 'errand' }).classList.contains('ui-pill--active')).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: 'All' }).classList.contains('ui-pill--active')).toBe(
      false,
    );
    expect(classesOf(screen.getByRole('link', { name: 'errand' }))).toEqual(
      expect.arrayContaining(['ui-pill', 'ui-pill--active', 'ui-pill--filter']),
    );
  });

  it('merges className instead of replacing it', () => {
    render(<TagFilterNav className="legacy-hook" items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(classesOf(nav)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-tag-filter-nav']),
    );
  });
});
