'use client';

import { useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Check, CircleX, Pencil, Plus, X } from 'lucide-react';
import { cx } from '../lib/cx';
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

/**
 * The manager row surface shared by `ListManager` and `TagManager`
 * (`SPEC-ui-managers`): a create field, then one row per item with an inline
 * rename editor and a menu holding the row actions. The two managers differ only
 * in the noun, the id type, and the BEM base, so all three are parameters.
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
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<T['id'] | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openId, setOpenId] = useState<T['id'] | null>(null);
  const canCreate = draft.trim() !== '';

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreate(name);
    setDraft('');
  };

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
      <div className={`${classPrefix}__create`}>
        <Input
          type="text"
          aria-label={placeholder}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              create();
            }
          }}
        />
        <IconButton label={createLabel} disabled={disabled || !canCreate} onClick={create}>
          <Plus size={16} aria-hidden />
        </IconButton>
      </div>
      <ul className={`${classPrefix}__list`}>
        {items.map((item) => (
          <li key={item.id} className={`${classPrefix}__row`}>
            {editingId === item.id ? (
              <div className={`${classPrefix}__edit`}>
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
                label={`Actions for ${item.name}`}
                summary={<span className={`${classPrefix}__name`}>{item.name}</span>}
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
