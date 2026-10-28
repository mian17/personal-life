// shadcn/ui registry copy (`card`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /**
   * Stretch the panel to the height its parent gives it and centre its content
   * inside that box — for a card that is a whole screen (the pomodoro timer)
   * rather than a panel in a page column. Off by default, so every existing
   * card keeps its content height.
   */
  fill?: boolean;
}

/**
 * The registry `card` surface, theme-mapped: `bg-card` is `bg-panel`, `text-card-foreground`
 * is `text-text`, `rounded-xl` is `--radius-lg`, and `border` draws `--border`. A card carries
 * the panel padding and clips what overflows it, as the hand-written atom did.
 */
const cardStyles =
  'rounded-[var(--radius-lg)] border border-border bg-panel p-[var(--space-0-9)] text-text';

/**
 * Full-height panel: the card is a screen, so it takes the height its parent hands it and
 * centres the content in that box. `safe` keeps an over-tall body scrollable from its first
 * row instead of clipping it above the scroll origin, and `auto` lets the card itself scroll
 * there — the base card's clipping would hide that content instead.
 */
const fillStyles = 'grid place-content-center-safe overflow-auto';

export function Card({ fill, className, children, ...rest }: Readonly<CardProps>) {
  return (
    <div
      data-slot="card"
      className={cx(
        'ui-card',
        cardStyles,
        fill ? cx('ui-card--fill', fillStyles) : 'overflow-hidden',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
