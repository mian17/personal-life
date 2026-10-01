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

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(SnackbarOptions & { key: number }) | null>(null);

  const showSnackbar = useCallback((options: SnackbarOptions) => {
    setCurrent({ ...options, key: Date.now() });
  }, []);

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
          onDismiss={() => setCurrent(null)}
        />
      )}
    </SnackbarContext.Provider>
  );
}
