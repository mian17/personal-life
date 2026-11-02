// shadcn/ui registry copy (`textarea`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type TextareaVariant = 'default' | 'editor';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  variant?: TextareaVariant;
}

/**
 * The registry `textarea`, theme-mapped the way `input` is, plus this package's `editor` variant:
 * the bare writing surface inside the editor body, so it drops the shell, the padding and the
 * focus outline, and takes the editor type size from `--fs-editor`.
 */
const textareaVariants = cva(
  cx(
    'block w-full min-w-0 [font:inherit] outline-none motion-safe:transition-colors',
    'placeholder:text-muted disabled:cursor-not-allowed disabled:text-muted',
  ),
  {
    variants: {
      variant: {
        default: cx(
          'min-h-16 resize-none rounded-md border border-border bg-panel px-3 py-2 text-base text-text',
          'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
        ),
        editor:
          'flex-1 resize-none border-0 rounded-none bg-transparent p-0 text-[length:var(--fs-editor)] [-webkit-tap-highlight-color:transparent]',
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
