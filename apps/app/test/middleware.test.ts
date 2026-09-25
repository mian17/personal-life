import { NextRequest } from 'next/server';

/**
 * ⚠️ AUTH-BYPASS TRAP (SPEC-app-state, review finding 2026-09-25).
 *
 * `sessionStore` is now a `SessionStoreApi` whose `get` returns `MaybePromise`.
 * With `REDIS_URL` set it is always a Promise, and `Boolean(promise)` is always
 * `true` — so a bare `Boolean(sessionStore.get(...))` would let every
 * unauthenticated request through. The middleware must `await` it.
 *
 * These tests pin BOTH directions against the real middleware with a controlled
 * async store. The "no session" case makes `get` resolve to `undefined` through a
 * Promise: if the `await` were dropped, this test fails (the request would pass).
 */

const mockGet = jest.fn();

jest.mock('@/lib/auth/session-store', () => ({
  sessionStore: { get: (id: string | undefined) => mockGet(id) },
}));

import { middleware } from '../middleware';
import { SESSION_COOKIE } from '@/lib/auth/cookies';

function request(path = '/', cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe('middleware identity gate (async store)', () => {
  beforeEach(() => mockGet.mockReset());

  it('redirects to login when there is no session (the async read is awaited)', async () => {
    // A resolved Promise carrying "no session": the trap case.
    mockGet.mockResolvedValue(undefined);
    const res = await middleware(request());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it('passes the request through when a live session exists', async () => {
    mockGet.mockResolvedValue({ id: 'sess-1', subject: 'me' });
    const res = await middleware(request('/', `${SESSION_COOKIE}=sess-1`));

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('sess-1');
  });

  it('redirects when the cookie names a session the store no longer has', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await middleware(request('/', `${SESSION_COOKIE}=stale`));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
  });

  it('lets public auth paths through without a session', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await middleware(request('/auth/callback'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
  });
});
