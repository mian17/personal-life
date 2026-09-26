import { cx } from '../lib/cx';
import { Pill } from './pill';

export interface TagFilterItem {
  name: string;
  href: string;
  active?: boolean;
}

export interface TagFilterNavProps {
  items: TagFilterItem[];
  className?: string;
  'aria-label'?: string;
}

export function TagFilterNav({ items, className, ...rest }: TagFilterNavProps) {
  return (
    <nav className={cx('ui-tag-filter-nav', className)} {...rest}>
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
