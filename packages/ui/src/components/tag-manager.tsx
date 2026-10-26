'use client';

import type { ComponentPropsWithRef } from 'react';
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
      className={className}
      {...rest}
    />
  );
}
