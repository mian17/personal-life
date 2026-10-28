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

/** The nav's own geometry: pills wrap on one baseline, with a row's breathing room. */
const navStyles =
  'flex flex-wrap items-baseline gap-[var(--space-0-5)] my-[var(--space-1-25)]';

/** A quiet row caption: same size and colour the retired `.ui-field-label` rule gave. */
const labelStyles = 'shrink-0 text-muted text-[length:var(--space-0-85)]';

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
