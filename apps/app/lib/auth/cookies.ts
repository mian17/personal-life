import 'server-only';

/**
 * App session cookie. HttpOnly, SameSite=Lax, Path=/, and `Secure` when the
 * caller says so — the dev-stack flag (`APP_DEV_SKIP_ACCESS_GATE=1`) decides;
 * these helpers never read `process.env` themselves, because `next build` inlines
 * `NODE_ENV` while that flag stays a runtime read. The value is an opaque session
 * id — never a token.
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
  secure: boolean,
  maxAgeSeconds?: number,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: maxAgeSeconds ?? 7 * 24 * 60 * 60,
  };
}

/** The equivalent options for clearing the cookie. */
export function clearedCookieOptions(secure: boolean): CookieOptions {
  return { ...sessionCookieOptions(secure, 0) };
}
