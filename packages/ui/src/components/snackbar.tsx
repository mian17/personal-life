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
 * The toast is the page's own raised surface lifted into the fab corner: one line, `--r-lg`, `--s4`
 * inset, no shadow. It sits above the fab (`z-30`) and below the scrim (`z-40`), so a sheet's
 * scrim dims it like everything else the page holds.
 *
 * The entry rides the transition instead of a keyframe: `starting:` is the first-frame style, so
 * the toast slides up on mount and the stylesheet owns no animation for it. It travels on the
 * fast duration without restating it — `base.css` holds both motion defaults inside the
 * `prefers-reduced-motion: no-preference` gate, which is what makes reduced motion instant.
 */
const toastStyles = cx(
  'fixed z-[35]',
  'left-[calc(var(--s4)+env(safe-area-inset-left))]',
  'bottom-[calc(var(--s4)+env(safe-area-inset-bottom))]',
  'flex items-center gap-[var(--s3)] m-0 list-none',
  'max-w-[calc(100vw-var(--s4)*2)]',
  'p-[var(--s3)_var(--s4)]',
  'bg-surface text-ink border border-line',
  'rounded-[var(--r-lg)]',
  'motion-safe:transition-[translate,opacity]',
  'starting:translate-y-[var(--s4)] starting:opacity-0',
);

/** The mirror of the entry: one step down and faded out, over the same transition. */
const leavingStyles = 'translate-y-[var(--s4)] opacity-0';

const textStyles = 'text-[length:var(--fs-label)]';
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
