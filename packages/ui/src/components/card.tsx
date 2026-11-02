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
  /**
   * Drop the panel inset and clip the children, for a card whose rows carry their own
   * insets — §8's `.card--flush`, the surface a grouped list of rows sits on.
   */
  flush?: boolean;
}

/** §8's `.card`, mapped onto the revised roles: the surface, the hairline and the large radius. */
const cardStyles = 'rounded-[var(--r-lg)] border border-line bg-surface text-ink';

/** A card clips what overflows it, as the hand-written atom did. */
const paddingStyles = 'p-[var(--s4)]';

/** §8's `.card--flush`: the rows inside own their insets, so the card only frames them. */
const flushStyles = 'p-0';

/**
 * Full-height panel: the card is a screen, so it takes the height its parent hands it and
 * centres the content in that box. `safe` keeps an over-tall body scrollable from its first
 * row instead of clipping it above the scroll origin, and `auto` lets the card itself scroll
 * there — the base card's clipping would hide that content instead.
 */
const fillStyles = 'grid place-content-center-safe overflow-auto';

export function Card({ fill, flush, className, children, ...rest }: Readonly<CardProps>) {
  return (
    <div
      data-slot="card"
      className={cx(
        'ui-card',
        flush && 'ui-card--flush',
        cardStyles,
        flush ? flushStyles : paddingStyles,
        fill ? cx('ui-card--fill', fillStyles) : 'overflow-hidden',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
