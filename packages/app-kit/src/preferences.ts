import { cookies } from 'next/headers';

/** The cookie name for a preference: `pref_<name>`, e.g. `pref_matrix`. */
export function prefCookieName<K extends string>(name: K): string {
  return `pref_${name}`;
}

/**
 * The attributes every preference cookie carries: one year, same site, never
 * readable from JavaScript, `Secure` when the caller says so (the dev-stack flag
 * decides — `NODE_ENV` does not, since `next build` forces it to production).
 */
export function preferenceCookieAttributes(secure: boolean) {
  return {
    path: '/',
    sameSite: 'lax' as const,
    httpOnly: true,
    secure,
    maxAge: 365 * 24 * 60 * 60,
  };
}

/**
 * Parse a raw cookie value into the preference's boolean state:
 * `'on' → true`; `'off'`, `undefined`, or any malformed value → `false` (OFF).
 */
export function parsePrefValue(raw: string | undefined): boolean {
  return raw === 'on';
}

/**
 * Parse a raw cookie value into a whole number of minutes: `'25' → 25`.
 * Absent, non-numeric (`'abc'`), fractional (`'2.5'`), empty, or negative
 * (`'-3'`) values → `undefined`, so the caller keeps its default.
 */
export function parsePrefNumber(raw: string | undefined): number | undefined {
  const isWholeNumber = raw !== undefined && /^\d+$/.test(raw);
  return isWholeNumber ? Number(raw) : undefined;
}

/**
 * Read a preference server-side (server component / route). Absent or malformed
 * cookies resolve to `false` (the OFF default). Fail-safe: never throws — a read
 * outside a request scope, or any cookie-store error, also returns `false`.
 */
export async function readPref<K extends string>(name: K): Promise<boolean> {
  return parsePrefValue(await readPreferenceCookie(name));
}

/**
 * Read a numeric preference server-side, the same fail-safe way `readPref`
 * reads a boolean one: anything unparseable resolves to the caller's `fallback`.
 */
export async function readPrefNumber<K extends string>(
  name: K,
  fallback: number,
): Promise<number> {
  return parsePrefNumber(await readPreferenceCookie(name)) ?? fallback;
}

async function readPreferenceCookie<K extends string>(name: K): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(prefCookieName(name))?.value;
  } catch {
    return undefined;
  }
}
