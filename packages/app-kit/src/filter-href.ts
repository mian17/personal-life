import type { QueryParams } from './types';

export interface FilterHrefInput {
  /** Route prefix, used verbatim (leading `/` for absolute hrefs). */
  path: string;
  /** The full current param bag — every key that must survive the change. */
  current?: QueryParams;
  /** Per-key overrides; `undefined` or `''` removes that key. */
  overrides?: QueryParams;
}

/**
 * Build a route href carrying the current params, overriding the given axes and
 * dropping every emptied one. Generic form of notes' `filterHref` and todos'
 * `todoHref`.
 */
export function filterHref(input: FilterHrefInput): string {
  const merged: Record<string, string | undefined> = { ...input.current, ...input.overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `${input.path}?${qs}` : input.path;
}
