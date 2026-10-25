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

export function TagFilterNav({ items, label, className, ...rest }: Readonly<TagFilterNavProps>) {
  return (
    <nav
      className={cx('ui-tag-filter-nav', className)}
      aria-label={rest['aria-label'] ?? label}
      {...rest}
    >
      {label != null && <span className="ui-field-label">{label}</span>}
      {items.map((item) => (
        <Pill
          key={item.name}
          as="a"
          size="filter"
          href={item.href}
          active={item.active}
        >
          {item.name}
        </Pill>
      ))}
    </nav>
  );
}
