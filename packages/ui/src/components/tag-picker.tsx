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

/**
 * A picker reads as one labelled row: the `fieldset` groups the chips natively, so its
 * browser-drawn border, padding and minimum width are all reset and the label rides the
 * chips' baseline instead of sitting above them as an orphan caption.
 */
const pickerStyles = cx(
  'flex flex-wrap items-baseline gap-[var(--s2)]',
  'min-w-0 m-0 p-0 border-0',
);

/**
 * The `legend`'s browser box would break the row, so only its text is kept. §8's field caption:
 * 13px, 650, `0.06em`, upper case, second ink tier — the same caption every labelled row uses.
 */
const labelStyles = cx(
  'inline p-0 shrink-0 uppercase text-ink-2',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/** The chips wrap on their own line, centred against each other, one `--s2` apart. */
const tagsStyles = 'flex flex-wrap items-center gap-[var(--s2)]';

/** The create row sits under the chips, pushed down by the block's own gap. */
const createStyles = 'flex items-center gap-[var(--s2)] mt-[var(--s3)]';

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
    <fieldset aria-label={label} className={cx('ui-tag-picker', pickerStyles, className)} {...rest}>
      <legend className={cx('ui-tag-picker__label ui-field-label', labelStyles)}>{label}</legend>
      <div className={cx('ui-tag-picker__tags', tagsStyles)}>
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
          className={cx('ui-tag-picker__create', createStyles)}
          placeholder={placeholder}
          createLabel={createLabel}
          disabled={disabled}
          onCreate={create}
        />
      )}
    </fieldset>
  );
}
