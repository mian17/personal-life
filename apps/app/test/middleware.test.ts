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

import { proxy } from '../proxy';
import { SESSION_COOKIE } from '@/lib/auth/cookies';

function request(path = '/', cookie?: string, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

describe('middleware identity gate (async store)', () => {
  beforeEach(() => mockGet.mockReset());

  it('redirects to login when there is no session (the async read is awaited)', async () => {
    // A resolved Promise carrying "no session": the trap case.
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it('passes the request through when a live session exists', async () => {
    mockGet.mockResolvedValue({ id: 'sess-1', subject: 'me' });
    const res = await proxy(request('/', `${SESSION_COOKIE}=sess-1`));

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('sess-1');
  });

  it('redirects when the cookie names a session the store no longer has', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request('/', `${SESSION_COOKIE}=stale`));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
  });

  it('lets public auth paths through without a session', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request('/auth/callback'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
  });

  it('carries the requested GET path as returnTo', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request('/todos'));

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/auth/login');
    expect(location).toContain('returnTo=%2Ftodos');
  });

  it('carries the query string in returnTo', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request('/todos?done=false'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('returnTo=%2Ftodos%3Fdone%3Dfalse');
  });

  it('does not carry returnTo for a POST to an API route', async () => {
    mockGet.mockResolvedValue(undefined);
    const res = await proxy(request('/api/notes/flush', undefined, 'POST'));

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/auth/login');
    expect(location).not.toContain('returnTo');
  });
});
