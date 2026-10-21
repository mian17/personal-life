import type { CookieOptions } from 'express';
import { SESSION_TTL_MS } from '../sessions/sessions.service';

export const SESSION_COOKIE = 'idp_session';

/**
 * Minimal typed Cookie-header reader — avoids pulling in cookie-parser for one cookie.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return undefined;
    // A malformed percent-encoding (e.g. `idp_session=%`) must never throw:
    // undecodable input is treated as "no cookie" so the caller fails closed to
    // the login redirect instead of turning the request into a 500.
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, SESSION_COOKIE);
}

/**
 * Secure unless the caller says the dev stack is in charge — that flag, not
 * `NODE_ENV`, is what marks a dev run (`next build` forces production on the
 * app's dev stack, so the two are indistinguishable by environment). The helper
 * reads no env itself: the flag is passed in, so a caller can never freeze the
 * wrong answer into a build.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: SESSION_TTL_MS,
  };
}
