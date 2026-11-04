// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { FeedbackNavItem } from './feedback-nav-item';
import { ManagerBlock } from './manager-block';
import { Pill } from './pill';
import { SettingsBlock } from './settings-block';
import { SettingsRow } from './settings-row';
import { ThemeToggle } from './theme-toggle';

export interface SettingsShellProps {
  /** Page title, forwarded to `ManagerBlock`'s frozen `<h1>`. Every settings route passes "Settings". */
  title: string;
  /** Back target, forwarded to `ManagerBlock`'s `IconLink` href: the app root. */
  backHref: string;
  /** Back control aria-label, forwarded to `ManagerBlock`; default "Back" (frozen). */
  backLabel?: string;
  /** Which app the Support row's feedback entry belongs to; forwarded to `FeedbackNavItem.app`. */
  app: string;
  /** The app's feedback server action; forwarded to `FeedbackNavItem.onSubmit` (receives the idempotency key). */
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** The app's own settings groups, rendered between Comfort and Support. Omitted renders nothing there. */
  children?: ReactNode;
}

/** The one Comfort line every app shows: report-only, so the read-out is a static `System` pill. */
const REDUCE_MOTION_COPY =
  'Follows the system setting. Turn it on in iOS Settings › Accessibility.';

/** §8's `.row__meta` as a standalone line, token classes only — see SPEC-ui-settings-shell. */
const footerStyles =
  'mt-[var(--s6)] text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

/**
 * The settings shape every app shares: Appearance, Comfort, the app's own groups, Support,
 * then the prototype line. The group order is the contract, so the shell owns it and a page
 * supplies only its app-specific rows as `children`.
 *
 * The Appearance group holds the segment alone (no `Theme` row label) and the Support row owns
 * its own copy in `FeedbackNavItem`. Both client leaves (`ThemeToggle`, `FeedbackNavItem`)
 * carry their own `'use client'`, so this stays a server component and the app's server action
 * reaches the dialog as a prop.
 */
export function SettingsShell({
  title,
  backHref,
  backLabel = 'Back',
  app,
  onSubmit,
  children,
}: Readonly<SettingsShellProps>): JSX.Element {
  return (
    <ManagerBlock title={title} backHref={backHref} backLabel={backLabel}>
      <SettingsBlock title="Appearance">
        <ThemeToggle inGroup />
      </SettingsBlock>

      <SettingsBlock title="Comfort">
        <SettingsRow
          label="Reduce motion"
          description={REDUCE_MOTION_COPY}
          control={<Pill>System</Pill>}
        />
      </SettingsBlock>

      {children}

      <SettingsBlock title="Support">
        <FeedbackNavItem app={app} onSubmit={onSubmit} variant="row" />
      </SettingsBlock>

      <p className={footerStyles}>Personal Life · prototype</p>
    </ManagerBlock>
  );
}
