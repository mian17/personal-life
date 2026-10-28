// shadcn/ui registry copy (`toast`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { Button } from './button';

/** The leave window: the toast holds still this long, then unmounts. */
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

/**
 * Registry toast root, theme-mapped: the page's own panel lifted into the fab corner, above the
 * fab's `z-10`. Every length rides a token, so no colour or measure enters the palette here.
 *
 * The entry rides the transition instead of a keyframe: `starting:` is the first-frame style, so
 * the toast slides up on mount and the stylesheet owns no animation for it.
 */
const toastStyles = cx(
  'fixed z-20',
  'left-[calc(var(--space-1)+env(safe-area-inset-left))]',
  'bottom-[calc(var(--space-1)+env(safe-area-inset-bottom))]',
  'flex items-center gap-[var(--space-0-75)] m-0 list-none',
  'max-w-[calc(100vw-var(--space-1)*2)]',
  'p-[var(--space-0-6)_var(--space-0-75)]',
  'bg-panel text-text border border-border',
  'rounded-[var(--radius-md)] shadow-[var(--shadow-fab)]',
  'transition-[translate,opacity] duration-[var(--duration-base)] ease-[var(--ease-standard)]',
  'starting:translate-y-[var(--space-1)] starting:opacity-0',
);

/** The mirror of the entry: one step down and faded out, over the same transition. */
const leavingStyles = 'translate-y-[var(--space-1)] opacity-0';

const textStyles = 'text-[length:var(--space-0-9)]';
const actionStyles = 'shrink-0';

export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 5000,
  className,
}: Readonly<SnackbarProps>) {
  const [leaving, setLeaving] = useState(false);
  // Radix portals its screen-reader announcer into a container of our choosing. The toast itself
  // already carries `role="status"`, so this container stays hidden and the message is announced
  // once, not twice.
  const [announcerContainer, setAnnouncerContainer] = useState<HTMLDivElement | null>(null);

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
    // `duration: Infinity` switches Radix's own countdown off: this component's timers own when
    // the toast arrives and when it leaves, and the leave window is what unmounts it.
    <ToastPrimitive.Provider
      duration={Infinity}
      announcerContainer={announcerContainer ?? undefined}
    >
      <ToastPrimitive.Root
        data-slot="toast"
        forceMount
        role="status"
        className={cx(
          'ui-snackbar',
          leaving && 'ui-snackbar--leaving',
          toastStyles,
          leaving && leavingStyles,
          className,
        )}
      >
        <span className={cx('ui-snackbar__text', textStyles)}>{message}</span>
        {actionLabel != null && (
          <Button
            variant="quiet"
            size="bare"
            className={cx('ui-snackbar__action', actionStyles)}
            onClick={() => {
              onAction?.();
              setLeaving(true);
            }}
          >
            {actionLabel}
          </Button>
        )}
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport />
      <div hidden ref={setAnnouncerContainer} />
    </ToastPrimitive.Provider>
  );
}
