import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './cookies';
import { getValidSession } from './session';
import type { AppSession } from './session-store';

/**
 * Resolves the current app session for a server component or action, or sends
 * the browser to the login entry. Unauthenticated access must never surface as a
 * 500 from the data layer — the middleware normally redirects first, but this is
 * the defense-in-depth for races and any path that reaches the data layer without
 * a session (the residual Task 10 flagged).
 *
 * `redirect()` throws Next's internal redirect error (a 307 to `/auth/login`),
 * which pages, server actions, and route handlers all understand.
 */
export async function requireSession(): Promise<AppSession> {
  const jar = await cookies();
  const session = await getValidSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect('/auth/login');
  }
  return session;
}
