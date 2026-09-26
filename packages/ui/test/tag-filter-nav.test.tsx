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
    expect(classesOf(nav)).toEqual(['ui-tag-filter-nav']);
    expect(nav.children).toHaveLength(0);
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
    expect(classesOf(screen.getByRole('link', { name: 'errand' }))).toEqual([
      'ui-pill',
      'ui-pill--active',
      'ui-pill--filter',
    ]);
  });

  it('merges className instead of replacing it', () => {
    render(<TagFilterNav className="legacy-hook" items={[]} />);
    expect(classesOf(screen.getByRole('navigation'))).toEqual([
      'legacy-hook',
      'ui-tag-filter-nav',
    ]);
  });
});
