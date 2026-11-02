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
  className?: string;
  'aria-label'?: string;
}

/**
 * §8's `.filters`: one row of chips that scrolls sideways rather than wrapping, run out to the
 * panel's edges and pulled back in by its own `--s4` inset, with the scrollbar hidden. The step
 * above the row is the section label's, so the nav draws no margin of its own below.
 */
const navStyles = cx(
  'flex gap-[var(--s2)] overflow-x-auto [scrollbar-width:none]',
  'mt-[var(--s3)] -mx-[var(--s4)] px-[var(--s4)]',
);

/** §8's field caption: 13px, 650, `0.06em`, upper case, second ink tier. */
const labelStyles = cx(
  'shrink-0 text-ink-2 uppercase',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

export function TagFilterNav({ items, label, className, ...rest }: Readonly<TagFilterNavProps>) {
  return (
    <nav
      className={cx('ui-tag-filter-nav', navStyles, className)}
      aria-label={rest['aria-label'] ?? label}
      {...rest}
    >
      {label != null && <span className={cx('ui-field-label', labelStyles)}>{label}</span>}
      {items.map((item) => (
        <Pill key={item.name} as="a" size="filter" href={item.href} active={item.active}>
          {item.name}
        </Pill>
      ))}
    </nav>
  );
}
