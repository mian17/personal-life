'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  CreateFeedbackInput,
  FeedbackApp,
  FeedbackSubmitResult,
  FeedbackType,
} from '@life/shared';
import { FEEDBACK_TITLE_MAX } from '@life/shared';
import { cx } from '../lib/cx';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';
import { StatusText } from './status-text';
import { segActiveStyles, segControlStyles, segTroughBaseStyles } from './tab-bar';
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
  /** Line under the title. Default the sheet's own one-line promise. */
  description?: string;
  /** Submit button label. Default "Send". */
  submitLabel?: string;
}

const DEFAULT_DESCRIPTION = 'One thing. It goes to the inbox, not to a ticket queue.';

/**
 * §8's `.field`: label over control, one `--s2` apart. The `--s4` between blocks comes from
 * `Dialog`'s body gap alone; a margin here would double it.
 */
const fieldStyles = 'ui-field flex flex-col gap-[var(--s2)]';

/**
 * §8's `.field__label`: 13px, 650, `0.06em`, upper case, second ink tier. Both class hooks stay
 * on the label, so the caption is still reachable by name.
 */
const labelStyles = cx(
  'ui-field-label ui-field-label--strong',
  'shrink-0 uppercase text-ink-2',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/**
 * §8's `.seg--theme` in the sheet: the shared trough from `segTroughBaseStyles` (borders, sunken
 * surface, `--s1` padding and gaps) stretched to the sheet's width, each control taking an equal
 * share of it.
 */
const typeTroughStyles = cx(segTroughBaseStyles, 'w-full', '[&>*]:flex-1');

/**
 * The picker's controls give up `segControlStyles`' `--s4` side padding for `--s2`: inside the
 * sheet a control's equal third is 109px at 375px, and "Enhancement" needs ~91px of text plus
 * two of these 8px paddings to fit, where `--s4` would floor it at ~123px and break the thirds.
 * `!` for the same reason `failureStyles` carries one — the `--s4` base is unconditional.
 */
const typeControlStyles = 'px-[var(--s2)]!';

/**
 * The one status line under the fields. A failure takes the danger ink, a validation hint keeps
 * the meta ink `StatusText` already carries; `!` because that base ink is unconditional.
 */
const failureStyles = 'text-danger!';

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
  description = DEFAULT_DESCRIPTION,
  submitLabel = 'Send',
}: Readonly<FeedbackFormProps>) {
  const [type, setType] = useState<FeedbackType>(FEEDBACK_TYPES[0].value);
  const [title, setTitle] = useState('');
  const [descriptionText, setDescriptionText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<'title' | 'description' | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // Label-to-control association is by construction: the SAME id is handed to the
  // `<label htmlFor>` and the control, so a label can never drift from its field.
  const titleId = useId();
  const descriptionId = useId();
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
    setDescriptionText('');
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
    if (descriptionText.trim().length === 0) {
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
        description: descriptionText.trim(),
      });
      if (result.ok) {
        onOpenChange(false);
      } else {
        // Same line, dialog stays open, same id kept for the retry.
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
      description={description}
      size="sheet"
      footer={
        <Button disabled={pending} onClick={submit}>
          {pending ? 'Sending…' : submitLabel}
        </Button>
      }
    >
      <div role="group" aria-label="Kind of feedback" className={typeTroughStyles}>
        {FEEDBACK_TYPES.map((feedbackType) => {
          const pressed = type === feedbackType.value;
          return (
            <button
              key={feedbackType.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => setType(feedbackType.value)}
              className={cx(
                'ui-seg__btn',
                pressed && 'ui-seg__btn--active',
                segControlStyles,
                typeControlStyles,
                // A `<button>` carries a UA face; the links `Tab`/`Segmented` render do not, so only
                // the unpressed branch here needs transparency, and it never sits beside the accent.
                pressed ? segActiveStyles : 'bg-transparent',
              )}
            >
              {feedbackType.shortLabel}
            </button>
          );
        })}
      </div>
      <div className={fieldStyles}>
        <label className={labelStyles} htmlFor={titleId}>
          Title
        </label>
        <Input
          ref={titleRef}
          id={titleId}
          aria-required
          maxLength={FEEDBACK_TITLE_MAX}
          aria-invalid={errorField === 'title' || undefined}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className={fieldStyles}>
        <label className={labelStyles} htmlFor={descriptionId}>
          Description
        </label>
        <Textarea
          ref={descriptionRef}
          id={descriptionId}
          aria-required
          aria-invalid={errorField === 'description' || undefined}
          value={descriptionText}
          onChange={(event) => setDescriptionText(event.target.value)}
        />
      </div>
      {error != null && (
        <StatusText className={errorField != null ? undefined : failureStyles}>{error}</StatusText>
      )}
    </Dialog>
  );
}
