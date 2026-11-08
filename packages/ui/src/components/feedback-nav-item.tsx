'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { FeedbackForm } from './feedback-form';
import { IconButton } from './icon-button';
import { SettingsRow } from './settings-row';

export type FeedbackNavItemVariant = 'icon' | 'row';

export interface FeedbackNavItemProps {
  /** Which app the entry belongs to (`'notes' | 'todos' | 'meals' | 'feedback'`). */
  app: string;
  /** Submit seam: the app passes its server action. Receives the idempotency key. */
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** IconButton aria-label (frozen visible text). Default "Send feedback". */
  label?: string;
  /**
   * `icon` is the toolbar control; `row` is §8's settings row whose label opens the same
   * dialog (the notes settings Support group). Default `icon`, so the other navs do not move.
   */
  variant?: FeedbackNavItemVariant;
}

/** §8's Support group copy; the row variant reads them, the icon variant has no room for them. */
const ROW_DESCRIPTION = 'Tell us what got in the way.';

/**
 * The feedback entry: it owns the dialog's `open` state (the app never manages
 * dialog state) and composes `FeedbackForm` inside. The trigger is either the
 * toolbar `IconButton` or a settings row — one dialog, two entry shapes.
 */
export function FeedbackNavItem({
  app,
  onSubmit,
  label = 'Send feedback',
  variant = 'icon',
}: Readonly<FeedbackNavItemProps>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === 'row' ? (
        <SettingsRow label={label} description={ROW_DESCRIPTION} onClick={() => setOpen(true)} />
      ) : (
        <IconButton label={label} onClick={() => setOpen(true)}>
          <MessageSquare size={20} aria-hidden />
        </IconButton>
      )}
      <FeedbackForm open={open} onOpenChange={setOpen} app={app} onSubmit={onSubmit} />
    </>
  );
}
