'use client';

import { useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Check, CircleX, Pencil, X } from 'lucide-react';
import { cx } from '../lib/cx';
import { CreateField } from './create-field';
import { Input } from './input';
import { IconButton } from './icon-button';
import { Menu } from './menu';

/** The shape a manager row needs: a stable id and a display name. */
export interface ManagerItem {
  id: string | number;
  name: string;
}

export interface ManagerSurfaceProps<T extends ManagerItem>
  extends Omit<ComponentPropsWithRef<'div'>, 'onCreate'> {
  /** Rows to render, in order. */
  items: T[];
  /** BEM base for this surface, e.g. `ui-tag-manager`. */
  classPrefix: string;
  /** Row noun used by aria labels, e.g. `tag` → `Rename tag X`. */
  noun: string;
  /** Accessible name for the surface. */
  label: string;
  /** Create-field placeholder, also its aria-label. */
  placeholder: string;
  /** Create button label. */
  createLabel: string;
  disabled?: boolean;
  /** Extra panel content rendered before the rename/delete actions. */
  rowExtra?: (item: T) => ReactNode;
  onCreate: (name: string) => void;
  onRename: (id: T['id'], name: string) => void;
  onDelete: (id: T['id']) => void;
}

/** The create field sits on one line: the input takes the width, the button follows. */
const createStyles = 'flex items-center gap-[var(--space-0-5)]';

/** Rows stack below the create field, clear of the browser's list box and markers. */
const listStyles = 'list-none m-[var(--space-0-5)_0_0] p-0 grid gap-[var(--space-0-4)]';

/** One row is one line: the menu takes the width, so the actions stay at the far end. */
const rowStyles = 'flex items-center gap-[var(--space-0-5)]';

/** The row menu is the row's only width-taking child. */
const menuStyles = 'flex-1 min-w-0';

/** The inline rename editor stands in for the row, so it takes the row's width. */
const editStyles = 'flex items-center gap-[var(--space-0-5)] flex-1';

/** The name fills the summary line and ellipsizes rather than pushing the trigger out. */
const nameStyles = 'flex-1 min-w-0';

/**
 * The manager row surface shared by `ListManager` and `TagManager`
 * (`SPEC-ui-managers`): a create field, then one row per item with an inline
 * rename editor and a menu holding the row actions. The two managers differ only
 * in the noun, the id type, and the BEM base, so all three are parameters.
 *
 * Each element keeps its `${classPrefix}__*` hook beside its utilities: the frozen
 * selector surface is those hooks, so the layout rides classes and the hooks stay bare.
 */
export function ManagerSurface<T extends ManagerItem>({
  items,
  classPrefix,
  noun,
  label,
  placeholder,
  createLabel,
  disabled = false,
  rowExtra,
  onCreate,
  onRename,
  onDelete,
  className,
  ...rest
}: Readonly<ManagerSurfaceProps<T>>) {
  const [editingId, setEditingId] = useState<T['id'] | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openId, setOpenId] = useState<T['id'] | null>(null);

  const create = (name: string) => onCreate(name);

  const startEdit = (item: T) => {
    setEditingId(item.id);
    setEditDraft(item.name);
  };

  const saveEdit = () => {
    if (editingId == null) return;
    const name = editDraft.trim();
    if (name === '') return;
    onRename(editingId, name);
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div className={cx(classPrefix, className)} aria-label={label} {...rest}>
      <CreateField
        className={cx(`${classPrefix}__create`, createStyles)}
        placeholder={placeholder}
        createLabel={createLabel}
        disabled={disabled}
        onCreate={create}
      />
      <ul className={cx(`${classPrefix}__list`, listStyles)}>
        {items.map((item) => (
          <li key={item.id} className={cx(`${classPrefix}__row`, rowStyles)}>
            {editingId === item.id ? (
              <div className={cx(`${classPrefix}__edit`, editStyles)}>
                <Input
                  type="text"
                  aria-label={`Rename ${noun} ${item.name}`}
                  value={editDraft}
                  disabled={disabled}
                  onChange={(event) => setEditDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveEdit();
                    }
                  }}
                />
                <IconButton
                  label="Save"
                  disabled={disabled || editDraft.trim() === ''}
                  onClick={saveEdit}
                >
                  <Check size={16} aria-hidden />
                </IconButton>
                <IconButton label="Cancel" disabled={disabled} onClick={cancelEdit}>
                  <X size={16} aria-hidden />
                </IconButton>
              </div>
            ) : (
              <Menu
                className={menuStyles}
                label={`Actions for ${item.name}`}
                summary={<span className={cx(`${classPrefix}__name`, nameStyles)}>{item.name}</span>}
                open={openId === item.id}
                onOpenChange={(next) => setOpenId(next ? item.id : null)}
                disabled={disabled}
              >
                {rowExtra?.(item)}
                <IconButton
                  label={`Rename ${noun} ${item.name}`}
                  disabled={disabled}
                  onClick={() => {
                    startEdit(item);
                    setOpenId(null);
                  }}
                >
                  <Pencil size={16} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Delete ${noun} ${item.name}`}
                  disabled={disabled}
                  onClick={() => {
                    onDelete(item.id);
                    setOpenId(null);
                  }}
                >
                  <CircleX size={16} aria-hidden />
                </IconButton>
              </Menu>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
