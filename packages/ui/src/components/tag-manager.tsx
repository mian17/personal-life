'use client';

import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { ManagerSurface } from './manager-surface';
import type { TagOption } from './tag-picker';

export interface TagManagerProps extends ComponentPropsWithRef<'div'> {
  tags: TagOption[];
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  createLabel?: string;
}

/**
 * §8's `.group` meets its rows flush and draws one `--line` hairline between them. The
 * shared `ManagerSurface` spaces its rows with a `--s1` gap, which would leave that rule
 * floating inside the gap, so the tag manager closes the gap on the list it owns and lets
 * the rows meet at the hairline the way the reference does.
 */
const groupRows = '[&>ul]:gap-0 [&>ul>*+*]:border-t [&>ul>*+*]:border-line';

/** Tag registry manager: `ManagerSurface` with the tag noun and numeric ids. */
export function TagManager({
  tags,
  onCreate,
  onRename,
  onDelete,
  disabled = false,
  label = 'Manage tags',
  placeholder = 'New tag',
  createLabel = 'Add tag',
  className,
  ...rest
}: Readonly<TagManagerProps>) {
  return (
    <ManagerSurface
      items={tags}
      classPrefix="ui-tag-manager"
      noun="tag"
      label={label}
      placeholder={placeholder}
      createLabel={createLabel}
      disabled={disabled}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      className={cx(groupRows, className)}
      {...rest}
    />
  );
}
