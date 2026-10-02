'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import { IconButton } from './icon-button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, title, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    const el = ref.current;
    if (!el) return;
    if (e.target !== el) return; // clicks on child content (incl. keyboard-activated controls)
    const rect = el.getBoundingClientRect();
    const outside =
      e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside) onOpenChange(false);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The native element owns the modal state; this component never mirrors it.
    if (open) {
      el.showModal();
    } else {
      el.close();
    }

    const handleClose = () => {
      // The `close` event also fires for the close() we just issued; only a
      // platform-initiated close (Escape/backdrop) may bubble up.
      if (open) onOpenChange(false);
    };
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [open, onOpenChange]);

  return (
    <dialog
      ref={ref}
      className={cx('ui-dialog', className)}
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      <div className="ui-dialog__head">
        <h2 className="ui-dialog__title" id={titleId}>
          {title}
        </h2>
        <IconButton label="Close" onClick={() => onOpenChange(false)}>
          <X size={20} aria-hidden />
        </IconButton>
      </div>
      <div className="ui-dialog__body">{children}</div>
      {footer != null && <div className="ui-dialog__footer">{footer}</div>}
    </dialog>
  );
}
