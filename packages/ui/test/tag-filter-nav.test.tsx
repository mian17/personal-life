import { render, screen } from '@testing-library/react';
import { TagFilterNav, type TagFilterItem } from '../src/components/tag-filter-nav';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function scrollerOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.ui-tag-filter-nav__scroll')!;
}

const twoTags: TagFilterItem[] = [
  { name: 'errand', href: '/?tag=errand' },
  { name: 'kitchen', href: '/?tag=kitchen' },
];

describe('TagFilterNav', () => {
  it('renders a <nav> with the ui-tag-filter-nav class', () => {
    const { container } = render(<TagFilterNav items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(nav.tagName).toBe('NAV');
    expect(nav.classList.contains('ui-tag-filter-nav')).toBe(true);
    expect(nav.children).toHaveLength(1);
    expect(nav.firstElementChild).toBe(scrollerOf(container));
  });

  it('carries the row geometry as utilities (the retired .ui-tag-filter-nav rule)', () => {
    render(<TagFilterNav items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(nav.classList.contains('flex')).toBe(true);
    expect(nav.classList.contains('gap-[var(--s2)]')).toBe(true);
    expect(nav.classList.contains('-mx-[var(--s4)]')).toBe(true);
    expect(nav.classList.contains('px-[var(--s4)]')).toBe(true);
  });

  it('routes the overflow, the width constraint and the edge fade through the scrolling strip', () => {
    const { container } = render(<TagFilterNav items={[]} />);
    const scroll = scrollerOf(container);
    expect(scroll.classList.contains('overflow-x-auto')).toBe(true);
    expect(scroll.classList.contains('min-w-0')).toBe(true);
    expect(scroll.classList.contains('flex-1')).toBe(true);
    expect(
      scroll.classList.contains(
        '[mask-image:linear-gradient(to_right,var(--surface)_calc(100%_-_var(--s6)),transparent)]',
      ),
    ).toBe(true);
    expect(screen.getByRole('navigation').classList.contains('overflow-x-auto')).toBe(false);
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

  it('pins the pinned chip to the nav itself, leaving only items in the scroller', () => {
    const { container } = render(
      <TagFilterNav
        aria-label="Tags"
        pinned={{ name: 'All', href: '/', active: true }}
        items={twoTags}
      />,
    );
    const pinned = screen.getByRole('link', { name: 'All' });
    expect(pinned.parentElement).toBe(screen.getByRole('navigation'));
    expect(scrollerOf(container).contains(pinned)).toBe(false);
    expect(pinned.classList.contains('ui-pill--active')).toBe(true);
    expect(pinned.classList.contains('ui-pill--filter')).toBe(true);
    expect(Array.from(scrollerOf(container).querySelectorAll('a')).map((a) => a.textContent)).toEqual(
      ['errand', 'kitchen'],
    );
  });

  it('scrolls every chip when no pinned chip is given', () => {
    const { container } = render(<TagFilterNav items={twoTags} />);
    expect(scrollerOf(container).querySelectorAll('a')).toHaveLength(twoTags.length);
    expect(screen.getByRole('navigation').querySelectorAll(':scope > a')).toHaveLength(0);
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
