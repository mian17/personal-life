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
 * used to carry. Its trailing edge fades (`matrix-block.tsx`'s technique) because a touch
 * browser paints no scrollbar to say the strip scrolls; the fade sits here, never on the nav,
 * so the pinned chip's own edges stay crisp.
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
  '[mask-image:linear-gradient(to_right,var(--page)_calc(100%_-_var(--s6)),transparent)]',
);

/** §8's field caption: 13px, 650, `0.06em`, upper case, second ink tier. */
const labelStyles = cx(
  'shrink-0 text-ink-2 uppercase',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

function FilterChip({ item }: Readonly<{ item: TagFilterItem }>) {
  return (
    <Pill as="a" size="filter" href={item.href} active={item.active}>
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
  return (
    <nav
      className={cx('ui-tag-filter-nav', navStyles, className)}
      aria-label={rest['aria-label'] ?? label}
      {...rest}
    >
      {label != null && <span className={cx('ui-field-label', labelStyles)}>{label}</span>}
      {pinned != null && <FilterChip item={pinned} />}
      <div className={scrollStyles}>
        {items.map((item) => (
          <FilterChip key={item.name} item={item} />
        ))}
      </div>
    </nav>
  );
}
