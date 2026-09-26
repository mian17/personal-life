import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type TextareaVariant = 'default' | 'editor';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  variant?: TextareaVariant;
}

export function Textarea({ variant = 'default', className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cx('ui-textarea', variant !== 'default' && `ui-textarea--${variant}`, className)}
      {...rest}
    />
  );
}
