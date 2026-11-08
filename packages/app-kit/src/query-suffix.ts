/**
 * Append `params` to `path` as a query string, or leave `path` bare when there is
 * nothing to append.
 *
 * One place knows how an optional query suffix is spelled. Every API lib in
 * `apps/app` shaped it by hand — `qs ? \`?${qs}\` : ''` glued onto a path — and a
 * suffix that exists in one spelling today is one that drifts into `?` vs `''` vs a
 * dangling `?` the first time someone edits it. The concatenation (rather than a
 * template literal) is deliberate: the suffix is a plain string join, and nesting
 * one template inside another to say so hides which part is optional.
 */
export function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? path : path + '?' + query;
}
