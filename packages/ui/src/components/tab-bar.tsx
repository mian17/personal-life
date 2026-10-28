// shadcn/ui registry copy (`tabs`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import Link from 'next/link';
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabProps {
  /** Destination route, app-supplied (e.g. list route or one of its views). */
  href: string;
  /** Marks the current tab, i.e. the route the app is on; Radix renders it `aria-selected`. */
  active?: boolean;
  /** Tab label (frozen visible text, app-supplied). */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

export interface TabBarProps {
  /** Tab list name (`aria-label`); frozen text, app-supplied. */
  'aria-label': string;
  /** `Tab`s in render order. */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

/**
 * Registry list, theme-mapped: one bordered rail holding the triggers, so the selected tab reads
 * as the accent surface and the rest stay muted. Radix owns `role="tablist"` and the roving focus.
 */
const listStyles = cx(
  'inline-flex items-center gap-[var(--space-0-4)]',
  'p-[var(--space-0-4)] mb-[var(--space-1)]',
  'rounded-[var(--radius-md)] border border-border bg-panel',
);

/**
 * Registry trigger, theme-mapped. Each trigger is a route link, so activation stays a real
 * navigation; arrow-key focus comes from the list, and Enter follows the `href` the browser and
 * `next/link` already handle. `outline-hidden` zeroes `--tw-outline-style` and `outline-<width>`
 * draws with that variable, so the focus ring needs `outline-solid` to exist at all.
 */
const tabStyles = cx(
  'inline-flex items-center justify-center whitespace-nowrap',
  'px-[var(--space-0-75)] py-[var(--space-0-5)] rounded-[var(--radius-md)]',
  'text-muted no-underline cursor-pointer transition-colors',
  'data-[state=active]:bg-accent data-[state=active]:text-on-accent',
  'outline-hidden focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
);

export function Tab({ href, active = false, children, className }: Readonly<TabProps>) {
  return (
    // `asChild` keeps the trigger an anchor: the tab's job is still to navigate, never to swap a
    // panel in place, so `href` survives and the active tab follows the route the app reports.
    // ponytail: Radix cancels ctrl-click on its triggers, so open-in-new-tab is gone; a variant
    // that owns the pointer events is the upgrade path once a consumer needs it.
    <TabsPrimitive.Trigger asChild value={href}>
      <Link
        href={href}
        data-slot="tabs-trigger"
        className={cx('ui-tab', active && 'ui-tab--active', tabStyles, className)}
      >
        {children}
      </Link>
    </TabsPrimitive.Trigger>
  );
}

export function TabBar({
  ['aria-label']: ariaLabel,
  children,
  className,
}: Readonly<TabBarProps>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" value={selectedHref(children)}>
      <TabsPrimitive.List
        aria-label={ariaLabel}
        data-slot="tabs-list"
        className={cx('ui-tab-bar', listStyles, className)}
      >
        {children}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

/** The selected value Radix needs: the route of the one `Tab` the app marked active, if any. */
function selectedHref(children: ReactNode): string | undefined {
  return tabsOf(children).find((tab) => tab.props.active)?.props.href;
}

function tabsOf(children: ReactNode): ReactElement<TabProps>[] {
  return Children.toArray(children).filter(isTab);
}

function isTab(node: ReactNode): node is ReactElement<TabProps> {
  return isValidElement<TabProps>(node) && node.type === Tab;
}
