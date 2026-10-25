'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ManagerSurface } from './manager-surface';

export interface TodoListOption {
  id: string;
  name: string;
}

export interface ListManagerProps extends ComponentPropsWithRef<'div'> {
  lists: TodoListOption[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  createLabel?: string;
  rowExtra?: (list: TodoListOption) => ReactNode;
}

/** Todo-list manager: `ManagerSurface` with the list noun and string ids. */
export function ListManager({
  lists,
  onCreate,
  onRename,
  onDelete,
  disabled = false,
  label = 'Manage lists',
  placeholder = 'New list',
  createLabel = 'Add list',
  rowExtra,
  className,
  ...rest
}: Readonly<ListManagerProps>) {
  return (
    <ManagerSurface
      items={lists}
      classPrefix="ui-list-manager"
      noun="list"
      label={label}
      placeholder={placeholder}
      createLabel={createLabel}
      disabled={disabled}
      rowExtra={rowExtra}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      className={className}
      {...rest}
    />
  );
}
