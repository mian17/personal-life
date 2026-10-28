// shadcn/ui registry copy (`input`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import type { ChangeEvent, ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FilePickerProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  /** Visible field label; also the control's accessible name. */
  label: string;
  /** Composes the field shell (icon + label); the native input stays the control. */
  children?: ReactNode;
  /** Convenience seam invoked with the selected files (the native event path stays open). */
  onFiles?: (files: FileList) => void;
}

/**
 * The registry `input` recipe split in two: `sr-only` keeps the native file input in the tab
 * order and the accessibility tree without painting it, and the surface below it draws the
 * affordance. Being the input's sibling is what lets the surface take focus and disabled from
 * `peer-focus-visible:` / `peer-disabled:` utilities instead of a stylesheet.
 *
 * Geometry and colour follow `input.tsx` — `border-border`, `bg-panel`, `rounded-md` — with a
 * dashed border to read as a drop zone. The visible label is also the control's accessible name,
 * so the atom is never `aria-label`-only (lesson 0014).
 */
const surfaceStyles = cx(
  'flex flex-col gap-1 p-3 rounded-md border border-dashed border-border bg-panel text-text',
  'cursor-pointer transition-colors',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
  'peer-disabled:cursor-default peer-disabled:opacity-50',
);

export function FilePicker({
  label,
  children,
  className,
  onFiles,
  onChange,
  accept = 'image/*',
  ...rest
}: Readonly<FilePickerProps>) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // jsdom dispatches programmatically even to a disabled control; enforce the contract.
    if (event.target.disabled) return;
    if (event.target.files) onFiles?.(event.target.files);
    onChange?.(event);
  };

  return (
    <label className={cx('ui-file-picker block', className)}>
      <input
        type="file"
        className="ui-file-picker__input peer sr-only"
        aria-label={label}
        accept={accept}
        onChange={handleChange}
        {...rest}
      />
      <span className={cx('ui-file-picker__surface', surfaceStyles)}>
        {children}
        <span className="ui-file-picker__label text-sm text-muted">{label}</span>
      </span>
    </label>
  );
}
