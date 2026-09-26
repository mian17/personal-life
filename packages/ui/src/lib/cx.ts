/**
 * `cx` — the only utility in `@life/ui`.
 *
 * Joins truthy class strings with a single space; falsy entries are dropped.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
