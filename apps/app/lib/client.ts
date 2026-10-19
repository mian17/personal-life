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
  const started = Date.now();
  // Request/response logging for the photo-door diagnosis: sizes, statuses and
  // the upstream's own error text only — never the body (it may be an image).
  console.info(`[bff] -> ${init?.method ?? 'GET'} ${base}${path} (${bodyBytes(init)} body bytes)`);
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(
      `[bff] <- ${res.status} ${init?.method ?? 'GET'} ${path} after ${Date.now() - started}ms: ${text.slice(0, 500) || '(empty body)'}`,
    );
    throw new ApiError(res.status, `API ${res.status} on ${path}`);
  }
  console.info(`[bff] <- ${res.status} ${init?.method ?? 'GET'} ${path} after ${Date.now() - started}ms`);
  return res.json() as Promise<T>;
}

/** The request body's byte length, for the log line — the body itself is never logged. */
function bodyBytes(init?: RequestInit): number {
  return typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
}
