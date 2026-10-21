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

async function writePref<K extends string>(name: K, raw: string): Promise<void> {
  const store = await cookies();
  // The dev-stack flag is read here, at the write site: cookie helpers take a
  // plain boolean, so `NODE_ENV` (inlined by `next build`) can never decide it.
  const secure = process.env.APP_DEV_SKIP_ACCESS_GATE !== '1';
  store.set(prefCookieName(name), raw, preferenceCookieAttributes(secure));
  revalidatePath('/', 'layout');
}
