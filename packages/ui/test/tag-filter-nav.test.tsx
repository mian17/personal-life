import { act, fireEvent, render, screen } from '@testing-library/react';
import { TagFilterNav, type TagFilterItem } from '../src/components/tag-filter-nav';

/** The strip's trailing-edge fade, verbatim: the conditional class this suite is about. */
const TRAILING_FADE =
  '[mask-image:linear-gradient(to_right,var(--page)_calc(100%_-_var(--s6)),transparent)]';

/**
 * jsdom has no layout, so every strip measures zero and the fade would never be reachable.
 * The suite states the strip's own geometry instead; `scrollLeft` stays writable so a scroll
 * can move the strip exactly the way a finger would.
 */
function measure(
  strip: HTMLElement,
  { scrollWidth, clientWidth, scrollLeft }: Record<'scrollWidth' | 'clientWidth' | 'scrollLeft', number>,
): void {
  for (const [name, value] of Object.entries({ scrollWidth, clientWidth, scrollLeft })) {
    Object.defineProperty(strip, name, { configurable: true, writable: true, value });
  }
}

/** jsdom has no `ResizeObserver`; this one fires on demand so a resize is a test decision. */
const observers: ResizeObserverStub[] = [];

class ResizeObserverStub {
  constructor(private readonly onResize: ResizeObserverCallback) {
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.onResize([], this as unknown as ResizeObserver);
  }
  static fireAll() {
    for (const observer of observers) observer.fire();
  }
}

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

beforeEach(() => {
  observers.length = 0;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
});

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

  it('routes the overflow and the width constraint through the scrolling strip', () => {
    const { container } = render(<TagFilterNav items={[]} />);
    const scroll = scrollerOf(container);
    expect(scroll.classList.contains('overflow-x-auto')).toBe(true);
    expect(scroll.classList.contains('min-w-0')).toBe(true);
    expect(scroll.classList.contains('flex-1')).toBe(true);
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

  it('fades only while chips remain past the trailing edge, clearing the fade at the end', () => {
    const { container } = render(<TagFilterNav items={twoTags} />);
    const strip = scrollerOf(container);
    expect(strip.classList.contains(TRAILING_FADE)).toBe(false);

    measure(strip, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    act(() => {
      fireEvent.scroll(strip);
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(true);

    strip.scrollLeft = 198;
    act(() => {
      fireEvent.scroll(strip);
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(true);

    strip.scrollLeft = 200;
    act(() => {
      fireEvent.scroll(strip);
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(false);
  });

  it('re-reads the strip on resize, fading a narrowed strip and clearing a widened one', () => {
    const { container } = render(<TagFilterNav items={twoTags} />);
    const strip = scrollerOf(container);
    measure(strip, { scrollWidth: 300, clientWidth: 100, scrollLeft: 200 });

    act(() => {
      ResizeObserverStub.fireAll();
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(false);

    measure(strip, { scrollWidth: 400, clientWidth: 50, scrollLeft: 200 });
    act(() => {
      ResizeObserverStub.fireAll();
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(true);

    measure(strip, { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 });
    act(() => {
      ResizeObserverStub.fireAll();
    });
    expect(strip.classList.contains(TRAILING_FADE)).toBe(false);
  });

  it('names the active chip as the current page for assistive tech', () => {
    const items: TagFilterItem[] = [
      { name: 'All', href: '/' },
      { name: 'errand', href: '/?tag=errand', active: true },
    ];
    render(<TagFilterNav items={items} />);
    expect(screen.getByRole('link', { name: 'errand' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks the pinned chip current too, so the unfiltered option reads as a state', () => {
    render(
      <TagFilterNav aria-label="Tags" pinned={{ name: 'All', href: '/', active: true }} items={twoTags} />,
    );
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'errand' }).getAttribute('aria-current')).toBeNull();
  });

  it('merges className instead of replacing it', () => {
    render(<TagFilterNav className="legacy-hook" items={[]} />);
    const nav = screen.getByRole('navigation');
    expect(classesOf(nav)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-tag-filter-nav']),
    );
  });
});
