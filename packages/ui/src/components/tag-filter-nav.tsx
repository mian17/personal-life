'use client';

import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { Pill } from './pill';

export interface TagFilterItem {
  name: string;
  href: string;
  active?: boolean;
}

export interface TagFilterNavProps {
  items: TagFilterItem[];
  /** A visible label rendered beside the pills (e.g. "Tags", "Lists"), matching
   *  the `PillGroup` pattern so every filter row reads clearly. Also used as the
   *  nav's accessible name. Omit for an unlabelled row. */
  label?: string;
  /** A chip that stays put at the row's leading edge while `items` scroll
   *  sideways under it — the unfiltered option you can always return to. Omit
   *  for a row whose every chip scrolls. */
  pinned?: TagFilterItem;
  className?: string;
  'aria-label'?: string;
}

/**
 * §8's `.filters`: one row of chips that scrolls sideways rather than wrapping, run out to the
 * panel's edges and pulled back in by its own `--s4` inset, with the scrollbar hidden. The step
 * above the row is the section label's, so the nav draws no margin of its own below. The row
 * carries no overflow of its own: the scrolling moved into the chips wrapper, so a pinned chip
 * outside that wrapper cannot be scrolled away.
 */
const navStyles = cx(
  'flex items-center gap-[var(--s2)]',
  'mt-[var(--s3)] -mx-[var(--s4)] px-[var(--s4)]',
);

/**
 * The scrolling chip strip: as wide as what is left of the row, taking the overflow the nav
 * used to carry. Its trailing edge fades (`matrix-block.tsx`'s technique) while there are chips
 * still to the right, so the cut reads as "scroll on" — a touch browser paints no scrollbar to
 * say the strip scrolls. The fade is the strip's alone, never the nav's, so the pinned chip's
 * own edges stay crisp, and it is dropped once the strip has reached its end (or never
 * overflowed) so the last chip is never half-faded.
 *
 * The fade colour must be the surface the row is actually painted on, never a neutral guess:
 * the row sits on the page (`base.css` paints `body` with `--page`), so fading to `--page` is
 * invisible while fading to the raised `--surface` smears a white patch across the page.
 * `matrix-block.tsx` follows the same rule one level down, fading to `--surface-sunken` because
 * its box sits on that sunken panel.
 */
const scrollStyles = cx(
  'ui-tag-filter-nav__scroll',
  'flex items-center gap-[var(--s2)] overflow-x-auto [scrollbar-width:none] min-w-0 flex-1',
);

/** `scrollLeft` is fractional and sub-pixel on touch; a hair of slack keeps a hairline of fade
 *  from lingering at the true end without hiding a real 2px remainder. */
const END_SLACK_PX = 1;

/** The trailing-edge fade, withheld until the strip has something left to reveal. */
const trailingFadeStyle =
  '[mask-image:linear-gradient(to_right,var(--page)_calc(100%_-_var(--s6)),transparent)]';

/** §8's field caption: 13px, 650, `0.06em`, upper case, second ink tier. */
const labelStyles = cx(
  'shrink-0 text-ink-2 uppercase',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/** `true` while at least one pixel of chips still sits past the strip's trailing edge. */
function hasChipsPastEdge(strip: HTMLElement): boolean {
  return strip.scrollWidth - strip.clientWidth - strip.scrollLeft > END_SLACK_PX;
}

/**
 * Tracks whether `strip` can still scroll right, refreshing on scroll, on mount, and whenever
 * the strip resizes — a narrower viewport is what turns a strip that fit back into an
 * overflowing one. The report never fires after unmount: the observer and the listener go with
 * the effect, and the mount read is skipped once the effect has been torn down.
 */
function useTrailingEdge(strip: HTMLElement | null): boolean {
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (strip == null) return;
    let live = true;
    const refresh = () => {
      if (live) setHasMore(hasChipsPastEdge(strip));
    };
    refresh();
    strip.addEventListener('scroll', refresh, { passive: true });
    const observer = new ResizeObserver(refresh);
    observer.observe(strip);
    return () => {
      live = false;
      observer.disconnect();
      strip.removeEventListener('scroll', refresh);
    };
  }, [strip]);
  return hasMore;
}

function FilterChip({ item }: Readonly<{ item: TagFilterItem }>) {
  return (
    <Pill as="a" size="filter" href={item.href} active={item.active} current={item.active}>
      {item.name}
    </Pill>
  );
}

export function TagFilterNav({
  items,
  label,
  pinned,
  className,
  ...rest
}: Readonly<TagFilterNavProps>) {
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const hasMore = useTrailingEdge(strip);

  return (
    <nav
      className={cx('ui-tag-filter-nav', navStyles, className)}
      aria-label={rest['aria-label'] ?? label}
      {...rest}
    >
      {label != null && <span className={cx('ui-field-label', labelStyles)}>{label}</span>}
      {pinned != null && <FilterChip item={pinned} />}
      <div ref={setStrip} className={cx(scrollStyles, hasMore && trailingFadeStyle)}>
        {items.map((item) => (
          <FilterChip key={item.name} item={item} />
        ))}
      </div>
    </nav>
  );
}
