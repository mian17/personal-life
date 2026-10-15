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

export function FilePicker({
  label,
  children,
  className,
  onFiles,
  onChange,
  accept = 'image/*',
  ...rest
}: FilePickerProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // jsdom dispatches programmatically even to a disabled control; enforce the contract.
    if (event.target.disabled) return;
    if (event.target.files) onFiles?.(event.target.files);
    onChange?.(event);
  };

  return (
    <label className={cx('ui-file-picker', className)}>
      <input
        type="file"
        className="ui-file-picker__input"
        aria-label={label}
        accept={accept}
        onChange={handleChange}
        {...rest}
      />
      <span className="ui-file-picker__surface">
        {children}
        <span className="ui-file-picker__label">{label}</span>
      </span>
    </label>
  );
}
