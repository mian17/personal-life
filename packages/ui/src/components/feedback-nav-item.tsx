'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { FeedbackForm } from './feedback-form';
import { IconButton } from './icon-button';

export interface FeedbackNavItemProps {
  /** Which app the entry belongs to (`'notes' | 'todos' | 'meals' | 'feedback'`). */
  app: string;
  /** Submit seam: the app passes its server action. Receives the idempotency key. */
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** IconButton aria-label (frozen visible text). Default "Send feedback". */
  label?: string;
}

/**
 * The toolbar item: it renders the `IconButton`, owns the dialog's `open` state
 * (the app never manages dialog state) and composes `FeedbackForm` inside.
 */
export function FeedbackNavItem({ app, onSubmit, label = 'Send feedback' }: FeedbackNavItemProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton label={label} onClick={() => setOpen(true)}>
        <MessageSquare size={20} aria-hidden />
      </IconButton>
      <FeedbackForm open={open} onOpenChange={setOpen} app={app} onSubmit={onSubmit} />
    </>
  );
}
