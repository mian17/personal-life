import 'server-only';

/**
 * App session cookie. HttpOnly, SameSite=Lax, Path=/, Secure in production.
 * The value is an opaque session id — never a token.
 */
export const SESSION_COOKIE = 'app_session';

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
}

export function sessionCookieOptions(
  isProduction: boolean = process.env.NODE_ENV === 'production',
  maxAgeSeconds?: number,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isProduction,
    maxAge: maxAgeSeconds ?? 7 * 24 * 60 * 60,
  };
}

/** The equivalent options for clearing the cookie. */
export function clearedCookieOptions(
  isProduction: boolean = process.env.NODE_ENV === 'production',
): CookieOptions {
  return { ...sessionCookieOptions(isProduction, 0) };
}
