'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  CreateFeedbackInput,
  FeedbackApp,
  FeedbackSubmitResult,
  FeedbackType,
} from '@life/shared';
import { FEEDBACK_TITLE_MAX } from '@life/shared';
import { AlertBanner } from './alert-banner';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';
import { Pill } from './pill';
import { PillGroup } from './pill-group';
import { Textarea } from './textarea';
import { FEEDBACK_TYPES } from './feedback-types';

export interface FeedbackFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which app the entry belongs to (`'notes' | 'todos' | 'feedback'`). */
  app: string;
  /** Submit seam: the app passes its server action. Receives the idempotency key. */
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** Dialog title (frozen visible text). Default "Send feedback". */
  title?: string;
  /** Submit button label. Default "Send". */
  submitLabel?: string;
}

const TITLE_REQUIRED = 'Title is required.';
const DESCRIPTION_REQUIRED = 'Description is required.';
const SUBMIT_FAILED = "Couldn't send feedback. Try again.";

/**
 * The submit-feedback dialog: three-way type picker + required title and
 * description, composed entirely from `@life/ui` primitives (no new visual
 * language).
 */
export function FeedbackForm({
  open,
  onOpenChange,
  app,
  onSubmit,
  title: dialogTitle = 'Send feedback',
  submitLabel = 'Send',
}: FeedbackFormProps) {
  const [type, setType] = useState<FeedbackType>(FEEDBACK_TYPES[0].value);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<'title' | 'description' | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // Idempotency key (SPEC-feedback-ui, locked intent 5): one per open, reused by
  // every attempt of that open, regenerated on a fresh open. Request path only —
  // never persisted, logged, or cached.
  const idRef = useRef('');

  useEffect(() => {
    if (!open) return;
    idRef.current = crypto.randomUUID();
    setError(null);
    setErrorField(null);
    setType(FEEDBACK_TYPES[0].value);
    setTitle('');
    setDescription('');
  }, [open]);

  async function submit() {
    // The rule is taught by the error, not by an inert button. Title is checked
    // first; both are trimmed, and the offending field owns the message.
    if (title.trim().length === 0) {
      setError(TITLE_REQUIRED);
      setErrorField('title');
      titleRef.current?.focus();
      return;
    }
    if (description.trim().length === 0) {
      setError(DESCRIPTION_REQUIRED);
      setErrorField('description');
      descriptionRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    setErrorField(null);
    try {
      const result = await onSubmit({
        id: idRef.current,
        app: app as FeedbackApp,
        type,
        title: title.trim(),
        description: description.trim(),
      });
      if (result.ok) {
        onOpenChange(false);
      } else {
        // Same banner, dialog stays open, same id kept for the retry.
        setError(result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : SUBMIT_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={dialogTitle}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? 'Sending…' : submitLabel}
          </Button>
        </>
      }
    >
      {error != null && <AlertBanner role="alert">{error}</AlertBanner>}
      <PillGroup role="group" aria-label="Feedback type">
        {FEEDBACK_TYPES.map((feedbackType) => (
          <Pill
            key={feedbackType.value}
            as="button"
            active={type === feedbackType.value}
            aria-pressed={type === feedbackType.value}
            onClick={() => setType(feedbackType.value)}
          >
            {feedbackType.label}
          </Pill>
        ))}
      </PillGroup>
      <Input
        ref={titleRef}
        aria-label="Title"
        aria-required
        maxLength={FEEDBACK_TITLE_MAX}
        aria-invalid={errorField === 'title' || undefined}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        ref={descriptionRef}
        aria-label="Description"
        aria-required
        aria-invalid={errorField === 'description' || undefined}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
    </Dialog>
  );
}
