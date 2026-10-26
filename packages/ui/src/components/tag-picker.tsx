'use client';

import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { CreateField } from './create-field';
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
  const create = (name: string) => onCreate?.(name);

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
        <CreateField
          className="ui-tag-picker__create"
          placeholder={placeholder}
          createLabel={createLabel}
          disabled={disabled}
          onCreate={create}
        />
      )}
    </fieldset>
  );
}
