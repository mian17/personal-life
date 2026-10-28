// Composed registry `button`, snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Button, type ButtonProps } from './button';

/**
 * The confirm is the only way through: a dismissal fires neither the form
 * submit nor the consumer's `onClick`.
 */
export interface ConfirmButtonProps extends Omit<ButtonProps, 'type'> {
  message: string;
  children: ReactNode;
}

export function ConfirmButton({ message, onClick, children, ...rest }: Readonly<ConfirmButtonProps>) {
  function confirmThenClick(event: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(message)) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <Button type="submit" onClick={confirmThenClick} {...rest}>
      {children}
    </Button>
  );
}
