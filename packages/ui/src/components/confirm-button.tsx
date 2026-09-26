'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './button';

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
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </Button>
  );
}
