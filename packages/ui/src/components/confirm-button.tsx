'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './button';

/**
 * The confirm is the only way through: a dismissal fires neither the form
 * submit nor the consumer's `onClick`.
 */
export interface ConfirmButtonProps extends Omit<ButtonProps, 'type'> {
  message: string;
  children: ReactNode;
}

export function ConfirmButton({ message, onClick, children, ...rest }: ConfirmButtonProps) {
  return (
    <Button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </Button>
  );
}
