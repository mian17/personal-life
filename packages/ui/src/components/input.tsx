import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type InputProps = ComponentPropsWithRef<'input'>;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cx('ui-input', className)} {...rest} />;
}
