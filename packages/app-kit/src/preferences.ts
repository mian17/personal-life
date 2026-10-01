import { cookies } from 'next/headers';

/** The cookie name for a preference: `pref_<name>`, e.g. `pref_matrix`. */
export function prefCookieName<K extends string>(name: K): string {
  return `pref_${name}`;
}

/**
 * Parse a raw cookie value into the preference's boolean state:
 * `'on' → true`; `'off'`, `undefined`, or any malformed value → `false` (OFF).
 */
export function parsePrefValue(raw: string | undefined): boolean {
  return raw === 'on';
}

/**
 * Read a preference server-side (server component / route). Absent or malformed
 * cookies resolve to `false` (the OFF default). Fail-safe: never throws — a read
 * outside a request scope, or any cookie-store error, also returns `false`.
 */
export async function readPref<K extends string>(name: K): Promise<boolean> {
  try {
    const store = await cookies();
    return parsePrefValue(store.get(prefCookieName(name))?.value);
  } catch {
    return false;
  }
}
