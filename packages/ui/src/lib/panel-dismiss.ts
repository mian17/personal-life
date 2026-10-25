'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface DismissablePanel {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Closes a panel on Escape or a pointerdown outside its root. */
export function usePanelDismiss({ rootRef, open, onOpenChange }: DismissablePanel) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [rootRef, open, onOpenChange]);
}
