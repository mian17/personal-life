import 'server-only';
import { ApiError } from './api-error';
import { requireSession } from './auth/require-session';

export { ApiError };

/**
 * The one BFF call primitive every service client shares (`lib/api.ts`,
 * `lib/tags-api.ts`, `lib/todo-api.ts`).
 *
 * The BFF authenticates to every backend with the caller's IdP access token
 * (JWT-only). Per the kernel transport contract (`SPEC-service-kernel`) there is
 * a single shared `life-api` audience — the session shape is unchanged, no
 * per-service audience or token exists here. `requireSession` is the single
 * choke point: every data call degrades to a login redirect when there is no
 * session, rather than throwing an error page. The browser never sees the token.
 */
export async function callService<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const session = await requireSession();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `API ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}
