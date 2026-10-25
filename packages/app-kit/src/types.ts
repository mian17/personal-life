/** A bag of query params; string values, absent keys and empty strings are dropped. */
export type QueryParams = Readonly<Record<string, string | undefined>>;
