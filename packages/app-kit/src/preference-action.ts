'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prefCookieName } from './preferences';

/**
 * Persist a preference and revalidate the app so the gated route re-renders.
 * A Server Action (called from the `Switch` in the settings page). `value`
 * encodes to `'on'` / `'off'`; the cookie is written with the attributes below.
 */
export async function setPref<K extends string>(name: K, value: boolean): Promise<void> {
  const store = await cookies();
  store.set(prefCookieName(name), value ? 'on' : 'off', {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60,
  });
  revalidatePath('/', 'layout');
}
