'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prefCookieName, preferenceCookieAttributes } from './preferences';

/**
 * Persist a boolean preference and revalidate the app so the gated route
 * re-renders. A Server Action (called from the `Switch` in the settings page).
 * `value` encodes to `'on'` / `'off'`.
 */
export async function setPref<K extends string>(name: K, value: boolean): Promise<void> {
  await writePref(name, value ? 'on' : 'off');
}

/**
 * Persist a numeric preference (whole minutes) as its decimal string, with the
 * same cookie attributes `setPref` writes, and revalidate the app.
 */
export async function setPrefNumber<K extends string>(name: K, value: number): Promise<void> {
  await writePref(name, String(value));
}

/**
 * Persist several numeric preferences in one round trip. Each write is an
 * independent cookie, so a per-preference `setPrefNumber` costs an extra
 * `cookies()` await and an extra `revalidatePath` for no benefit: this resolves
 * the cookie store and revalidates the app exactly once for the whole batch.
 */
export async function setPrefNumbers(
  entries: readonly (readonly [string, number])[],
): Promise<void> {
  if (entries.length === 0) return;
  const store = await cookies();
  const secure = devStackSecuresCookies();
  for (const [name, value] of entries) {
    store.set(prefCookieName(name), String(value), preferenceCookieAttributes(secure));
  }
  revalidatePath('/', 'layout');
}

async function writePref<K extends string>(name: K, raw: string): Promise<void> {
  const store = await cookies();
  store.set(prefCookieName(name), raw, preferenceCookieAttributes(devStackSecuresCookies()));
  revalidatePath('/', 'layout');
}

/**
 * Whether the cookie carries `Secure`. Read at the write site: cookie helpers
 * take a plain boolean, so `NODE_ENV` (inlined by `next build`) can never decide
 * it — only the dev-stack flag can.
 */
function devStackSecuresCookies(): boolean {
  return process.env.APP_DEV_SKIP_ACCESS_GATE !== '1';
}
