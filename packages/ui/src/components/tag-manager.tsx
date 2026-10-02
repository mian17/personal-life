'use client';

import { useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Check, CircleX, Pencil, Plus, X } from 'lucide-react';
import { cx } from '../lib/cx';
import { Input } from './input';
import { IconButton } from './icon-button';
import { Menu } from './menu';
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
}: TagManagerProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const canCreate = draft.trim() !== '';

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreate(name);
    setDraft('');
  };

  const startEdit = (tag: TagOption) => {
    setEditingId(tag.id);
    setEditDraft(tag.name);
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
    <div className={cx('ui-tag-manager', className)} aria-label={label} {...rest}>
      <div className="ui-tag-manager__create">
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
      <ul className="ui-tag-manager__list">
        {tags.map((tag) => (
          <li key={tag.id} className="ui-tag-manager__row">
            {editingId === tag.id ? (
              <div className="ui-tag-manager__edit">
                <Input
                  type="text"
                  aria-label={`Rename tag ${tag.name}`}
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
                label={`Actions for ${tag.name}`}
                summary={<span className="ui-tag-manager__name">{tag.name}</span>}
                open={openId === tag.id}
                onOpenChange={(next) => setOpenId(next ? tag.id : null)}
                disabled={disabled}
              >
                <IconButton
                  label={`Rename tag ${tag.name}`}
                  disabled={disabled}
                  onClick={() => {
                    startEdit(tag);
                    setOpenId(null);
                  }}
                >
                  <Pencil size={16} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Delete tag ${tag.name}`}
                  disabled={disabled}
                  onClick={() => {
                    onDelete(tag.id);
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
