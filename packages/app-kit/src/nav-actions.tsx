// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { Fragment, createElement } from 'react';
import { SettingsLink } from '@life/ui';
import type { AppScope } from './route-layout';
import { settingsHref } from './settings-route';

/**
 * The `NavBar` trailing actions node for an app: any leading controls first, the settings gear
 * last. The gear is the closed `SettingsLink` face at the app's `settingsHref('/' + scope)`.
 * Feedback is never here — the settings screen's Support row is its only door.
 *
 * This is a node factory, not a component: call it for a node (`navTrailing={navActions('notes')}`),
 * never mount it. It renders no element of its own — the returned node IS the gear, or a fragment
 * of the leading controls followed by the gear — so a nav component that returns it keeps a
 * `SettingsLink` element identity, and nothing extra reaches the DOM.
 */
export function navActions(scope: AppScope, leading?: ReactNode): JSX.Element {
  const gear = createElement(SettingsLink, { href: settingsHref(`/${scope}`) });
  return leading == null ? gear : createElement(Fragment, null, leading, gear);
}
