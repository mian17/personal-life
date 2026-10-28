// shadcn/ui registry copy (`toast` host), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Snackbar } from './snackbar';

export interface SnackbarOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

export interface SnackbarApi {
  showSnackbar: (options: SnackbarOptions) => void;
}

const SnackbarContext = createContext<SnackbarApi>({ showSnackbar: () => {} });

export function useSnackbar(): SnackbarApi {
  return useContext(SnackbarContext);
}

/** One queued snackbar; the key tells two identical messages apart, so a repeat restarts it. */
interface QueuedSnackbar extends SnackbarOptions {
  key: number;
}

/**
 * The app's snackbar host. `Snackbar` carries its own Radix toast provider and viewport, so it
 * also works rendered on its own; this host only decides which message is up and when it goes.
 * One message shows at a time — a second call replaces the first, matching one undo affordance.
 */
export function SnackbarProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [current, setCurrent] = useState<QueuedSnackbar | null>(null);

  const showSnackbar = useCallback((options: SnackbarOptions) => {
    setCurrent({ ...options, key: Date.now() });
  }, []);

  const dismiss = useCallback(() => setCurrent(null), []);

  const api = useMemo<SnackbarApi>(() => ({ showSnackbar }), [showSnackbar]);

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {current && (
        <Snackbar
          key={current.key}
          message={current.message}
          actionLabel={current.actionLabel}
          onAction={current.onAction}
          duration={current.duration}
          onDismiss={dismiss}
        />
      )}
    </SnackbarContext.Provider>
  );
}
