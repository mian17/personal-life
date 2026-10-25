'use client';

import { useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Plus } from 'lucide-react';
import { cx } from '../lib/cx';
import { Input } from './input';
import { IconButton } from './icon-button';
import { Pill } from './pill';

export interface TagOption {
  id: number;
  name: string;
}

export interface TagPickerProps extends Omit<ComponentPropsWithRef<'fieldset'>, 'onToggle'> {
  tags: TagOption[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onCreate?: (name: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  createLabel?: string;
}

export function TagPicker({
  tags,
  selectedIds,
  onToggle,
  onCreate,
  disabled = false,
  label = 'Tags',
  placeholder = 'New tag',
  createLabel = 'Add tag',
  className,
  ...rest
}: Readonly<TagPickerProps>) {
  const [draft, setDraft] = useState('');
  const canCreate = draft.trim() !== '';

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreate?.(name);
    setDraft('');
  };

  return (
    <fieldset aria-label={label} className={cx('ui-tag-picker', className)} {...rest}>
      <legend className="ui-tag-picker__label ui-field-label">{label}</legend>
      <div className="ui-tag-picker__tags">
        {tags.map((tag) => {
          const selected = selectedIds.includes(tag.id);
          return (
            <Pill
              key={tag.id}
              as="a"
              size="filter"
              active={selected}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onToggle(tag.id)}
            >
              {tag.name}
            </Pill>
          );
        })}
      </div>
      {onCreate != null && (
        <div className="ui-tag-picker__create">
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
          <IconButton
            label={createLabel}
            disabled={disabled || !canCreate}
            onClick={create}
          >
            <Plus size={16} aria-hidden />
          </IconButton>
        </div>
      )}
    </fieldset>
  );
}
