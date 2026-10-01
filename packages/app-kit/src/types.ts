/** A route prefix used verbatim, e.g. `/notes` (absolute) or `list` (relative). */
export type RoutePath = string;
/** A bag of query params; string values, absent keys and empty strings are dropped. */
export type QueryParams = Readonly<Record<string, string | undefined>>;
/**
 * A known preference key. app-kit holds **no** concrete keys — an app declares its
 * own union (e.g. `type AppPrefKey = 'matrix'`) and extends it to add a preference.
 * Never fork these helpers per app or per key.
 */
export type PrefKey = string;
