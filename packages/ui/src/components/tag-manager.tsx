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
 * §8's `.group` separates neighbouring rows with a `--line` hairline; the shared
 * `ManagerSurface` spaces its rows instead, so the tag manager restores the divider
 * on the list it owns.
 */
const rowHairlines = '[&>ul>*+*]:border-t [&>ul>*+*]:border-line';

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
      className={cx(rowHairlines, className)}
      {...rest}
    />
  );
}
