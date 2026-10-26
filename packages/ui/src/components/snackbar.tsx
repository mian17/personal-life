'use client';

import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { Button } from './button';

const EXIT_MS = 200;

export interface SnackbarProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms (action/dismiss clears it). Default 5000. */
  duration?: number;
  className?: string;
}

export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 5000,
  className,
}: Readonly<SnackbarProps>) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(onDismiss, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, onDismiss]);

  return (
    <output
      className={cx('ui-snackbar', leaving && 'ui-snackbar--leaving', className)}
    >
      <span className="ui-snackbar__text">{message}</span>
      {actionLabel != null && (
        <Button
          variant="quiet"
          size="bare"
          className="ui-snackbar__action"
          onClick={() => {
            onAction?.();
            setLeaving(true);
          }}
        >
          {actionLabel}
        </Button>
      )}
    </output>
  );
}
