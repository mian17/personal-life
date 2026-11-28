import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StatusTextSize = 'default' | 'display';

export interface StatusTextProps extends ComponentPropsWithRef<'span'> {
  /** `'display'` scales a short read-out, e.g. a countdown's digits. */
  size?: StatusTextSize;
  /**
   * The `display` tier's figure treatment: 600 weight, the timer's leading, the timer's tight
   * tracking, full ink. Ignored at the default tier, which has no figure to treat.
   */
  figure?: boolean;
  /** Hide the line but keep its height reserved (`visibility: hidden`, not `display: none`). */
  invisible?: boolean;
}

/**
 * A save read-out or a countdown: the meta tier by default, the timer tier for
 * `'display'`, both from §4's scale.
 *
 * `invisible` is Tailwind's `visibility: hidden`, never `display: none`: a caller hides the
 * line precisely to stop the layout moving, so the box has to stay. `ui-invisible` rides
 * along as the hook `apps/pomodoro` asserts on the rendered line.
 */
const sizeStyles: Record<StatusTextSize, string> = {
  default: 'text-[length:var(--fs-meta)]',
  display: 'text-[length:var(--fs-timer)]',
};

/**
 * The line's ink, one tier at a time: a figure is a result and reads in full ink, where the
 * default line is the second tier. Selecting the tier keeps one declaration of `color` on the span.
 */
const inkStyles: Record<'default' | 'figure', string> = {
  default: 'text-ink-2',
  figure: 'text-ink',
};

/** The figure's type: the timer's weight, leading and tracking, none of which the base declares. */
const figureStyles =
  '[font-weight:var(--fw-semibold)] leading-[var(--lh-kpi)] tracking-[var(--tracking-timer)]';

export function StatusText({
  size = 'default',
  figure = false,
  invisible,
  className,
  children,
  ...rest
}: Readonly<StatusTextProps>) {
  const showsFigure = figure && size === 'display';

  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(
        'ui-status-text',
        inkStyles[showsFigure ? 'figure' : 'default'],
        sizeStyles[size],
        size === 'display' && 'ui-status-text--display',
        showsFigure && figureStyles,
        invisible && 'ui-invisible invisible',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
