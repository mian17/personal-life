// shadcn/ui registry copy (`textarea`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type TextareaVariant = 'default' | 'editor';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  variant?: TextareaVariant;
}

/**
 * The revised `.textarea` (REVISED-DESIGN §8): a 200px writing area on the strong hairline,
 * body type at the longform leading, no resize handle.
 *
 * `editor` is the bare writing surface inside the note editor: it drops the shell, the
 * padding and the focus outline, and the editor screen owns the frame around it.
 */
const textareaVariants = cva(
  cx(
    'block w-full min-w-0 [font:inherit] outline-none motion-safe:transition-colors',
    'placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3',
  ),
  {
    variants: {
      variant: {
        // §8's 200px floor as the six-and-a-quarter 32px steps it is drawn from.
        default: cx(
          'min-h-[calc(var(--s8)*6.25)] px-[var(--s4)] py-[var(--s3)]',
          'rounded-[var(--r-md)] border border-line-strong bg-surface resize-none',
          'text-[length:var(--fs-body)] leading-[var(--lh-body-longform)] text-ink',
          'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
        ),
        editor:
          'flex-1 resize-none border-0 rounded-none bg-transparent p-0 text-[length:var(--fs-body)] [-webkit-tap-highlight-color:transparent]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Textarea({ variant = 'default', className, ...rest }: Readonly<TextareaProps>) {
  return (
    <textarea
      data-slot="textarea"
      className={cx(
        'ui-textarea',
        variant !== 'default' && `ui-textarea--${variant}`,
        textareaVariants({ variant }),
        className,
      )}
      {...rest}
    />
  );
}
