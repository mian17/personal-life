import type { RoutePath } from './types';

/**
 * The app-scoped settings path for a route: the settings segment is appended to
 * the route's own prefix, keeping the settings page inside that route's app. A
 * trailing slash on `route` is normalized so the join never yields a double slash.
 * Pure string join — no `path`, no markup.
 */
export function settingsHref(route: RoutePath): string {
  let prefix = route;
  while (prefix.endsWith('/')) prefix = prefix.slice(0, -1);
  return `${prefix}/settings`;
}
