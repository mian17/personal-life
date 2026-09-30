/** A route prefix used verbatim, e.g. `/notes` (absolute) or `list` (relative). */
export type RoutePath = string;
/** A bag of query params; string values, absent keys and empty strings are dropped. */
export type QueryParams = Readonly<Record<string, string | undefined>>;
