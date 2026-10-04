import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface DisclosureProps {
  label: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A collapsible region: the `label` stays visible, `children` fold away beneath it.
 *
 * The open state is the native `<details>`/`<summary>` attribute, not JS — the
 * platform owns the toggle, the keyboard, and the expanded/collapsed state
 * assistive tech reads, so this stays a server component and still works with
 * JavaScript disabled. Uncontrolled on purpose: `defaultOpen` sets only the first
 * render, and no consumer drives the state from outside yet.
 * See `docs/specs/SPEC-ui-blocks-disclosure.md`.
 */
export function Disclosure({
  label,
  defaultOpen = false,
  className,
  children,
}: DisclosureProps) {
  return (
    <details className={cx('ui-disclosure', className)} open={defaultOpen}>
      <summary className="ui-disclosure__summary">{label}</summary>
      <div className="ui-disclosure__body">{children}</div>
    </details>
  );
}
