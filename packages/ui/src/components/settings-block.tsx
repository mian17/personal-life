import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Card } from './card';
import { Section } from './section';

export interface SettingsBlockProps {
  /** Group heading; omitted renders no heading row. */
  title?: string;
  /** The `SettingsRow`s (or any content) in render order. */
  children: ReactNode;
  /**
   * The block's closing action(s), drawn on the card under the rows: its own inset and the
   * hairline the rows box cannot draw below its last child, so a full-width `Button` lines up
   * with the row controls instead of competing with the row inset. Omitted renders nothing.
   */
  footer?: ReactNode;
  /** Class passthrough. */
  className?: string;
}

/**
 * The group owns the row geometry: a flush card draws the surface and the outer hairline, and
 * each child takes the row inset with a hairline between neighbours. A `SettingsRow` therefore
 * carries no padding of its own, so it reads the same standalone in a nested field body.
 */
const rowsStyles = 'divide-y divide-line [&>*]:px-[var(--s4)] [&>*]:py-[var(--s3)]';

/** The footer's own inset is the row step, so its control lines up with the row controls above. */
const footerStyles =
  'ui-settings-block__footer border-t border-line px-[var(--s4)] py-[var(--s3)]';

export function SettingsBlock({
  title,
  children,
  footer,
  className,
}: Readonly<SettingsBlockProps>) {
  return (
    <Section label={title} className={className}>
      <Card flush>
        <div className={cx('ui-settings-block__rows', rowsStyles)}>{children}</div>
        {footer != null && <div className={footerStyles}>{footer}</div>}
      </Card>
    </Section>
  );
}
