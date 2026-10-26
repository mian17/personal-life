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

export function Card({ fill, className, children, ...rest }: Readonly<CardProps>) {
  return (
    <div className={cx('ui-card', fill && 'ui-card--fill', className)} {...rest}>
      {children}
    </div>
  );
}
