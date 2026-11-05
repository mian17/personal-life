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

export interface Segment {
  /** Destination route, app-supplied (e.g. one filter value of the current view). */
  href: string;
  /** Control label (frozen visible text, app-supplied). */
  label: string;
  /** Marks the segment the current URL already shows. */
  active?: boolean;
}

export interface SegmentedProps {
  /** Group name (`aria-label`); frozen text, app-supplied. */
  'aria-label': string;
  /** Segments in render order. */
  items: Segment[];
  /** Class passthrough. */
  className?: string;
}

/**
 * §8's `.seg`: one trough holding the controls, one `--s1` apart on the sunken fill, so the
 * selected one reads as the accent fill and the rest stay in the second ink tier. The trough
 * without its page-top margin is what a control that already sits in a row (the appearance
 * segment) composes, so the one `.seg` look has a single declaration.
 */
export const segTroughBaseStyles = cx(
  'inline-flex items-center gap-[var(--s1)]',
  'p-[var(--s1)]',
  'rounded-[var(--r-md)] border border-line bg-surface-sunken',
);

const segTroughStyles = cx(segTroughBaseStyles, 'mt-[var(--s4)]');

/**
 * §8's `.seg__btn`: a route link on the trough, a tap target tall, pressed-accent when it is the
 * current one. Enter follows the `href` the browser and `next/link` already handle.
 * `outline-hidden` zeroes `--tw-outline-style` and `outline-<width>` draws with that variable, so
 * the focus ring needs `outline-solid` to exist at all.
 */
export const segControlStyles = cx(
  'inline-flex items-center justify-center whitespace-nowrap',
  'min-h-[var(--tap)] px-[var(--s4)] rounded-[var(--r-sm)]',
  'text-[length:var(--fs-chip)] font-semibold tracking-[var(--tracking-button)]',
  'text-ink-2 no-underline cursor-pointer motion-safe:transition-colors',
  'active:bg-max-press',
  'outline-hidden focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-max',
);

/** The one selected control wears the accent fill, whichever control family draws it. */
export const segActiveStyles = 'bg-max text-on-max';

/** A tab additionally follows Radix's forwarded `data-state`, which `asChild` does emit. */
const tabStyles = cx(segControlStyles, 'data-[state=active]:bg-max data-[state=active]:text-on-max');

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
        className={cx(
          'ui-tab',
          active && 'ui-tab--active',
          tabStyles,
          // The surface follows the prop the app already passes, so it cannot depend on
          // Radix forwarding `data-state` onto the `asChild` anchor.
          active && segActiveStyles,
          className,
        )}
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
        className={cx('ui-tab-bar', segTroughStyles, className)}
      >
        {children}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

/**
 * §8's `.seg` as a filter: the same trough and control as `TabBar`, drawn as plain route links in a
 * `group`. Tabs own a tablist and roving focus because they swap panels; a filter only navigates,
 * so its controls stay links and the current one is named `aria-current` — `aria-pressed` is not
 * supported on the link role.
 */
export function Segmented({
  ['aria-label']: ariaLabel,
  items,
  className,
}: Readonly<SegmentedProps>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cx('ui-seg', segTroughStyles, className)}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          data-slot="segmented-item"
          aria-current={item.active === true ? 'page' : undefined}
          className={cx(
            'ui-seg__btn',
            item.active && 'ui-seg__btn--active',
            segControlStyles,
            item.active && segActiveStyles,
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
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
