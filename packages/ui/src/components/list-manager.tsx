'use client';

import { useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Check, CircleX, Pencil, Plus, X } from 'lucide-react';
import { cx } from '../lib/cx';
import { Input } from './input';
import { IconButton } from './icon-button';

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
}

export function ListManager({
  lists,
  onCreate,
  onRename,
  onDelete,
  disabled = false,
  label = 'Manage lists',
  placeholder = 'New list',
  createLabel = 'Add list',
  className,
  ...rest
}: ListManagerProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const canCreate = draft.trim() !== '';

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreate(name);
    setDraft('');
  };

  const startEdit = (list: TodoListOption) => {
    setEditingId(list.id);
    setEditDraft(list.name);
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
    <div className={cx('ui-list-manager', className)} aria-label={label} {...rest}>
      <div className="ui-list-manager__create">
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
      <ul className="ui-list-manager__list">
        {lists.map((list) => (
          <li key={list.id} className="ui-list-manager__row">
            {editingId === list.id ? (
              <div className="ui-list-manager__edit">
                <Input
                  type="text"
                  aria-label={`Rename list ${list.name}`}
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
              <>
                <span className="ui-list-manager__name">{list.name}</span>
                <IconButton
                  label={`Rename list ${list.name}`}
                  disabled={disabled}
                  onClick={() => startEdit(list)}
                >
                  <Pencil size={16} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Delete list ${list.name}`}
                  disabled={disabled}
                  onClick={() => onDelete(list.id)}
                >
                  <CircleX size={16} aria-hidden />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
