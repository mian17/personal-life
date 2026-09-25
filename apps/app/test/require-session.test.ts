import { sessionStore } from '@/lib/auth/session-store';

/**
 * Data-path degradation (2026-09-25): unauthenticated requests that reach the
 * data layer redirect to `/auth/login` (Next's NEXT_REDIRECT, a 307) instead of
 * surfacing a 500. Middleware normally redirects first; this is the
 * defense-in-depth for races and any path that bypasses the matcher.
 *
 * These exercise the real server components' data calls and the real BFF route
 * handlers, not just the helper: the route handlers' catch blocks must let the
 * redirect through rather than turning it into a 502.
 */

// `cookies()` is request-scoped in Next; in tests we control the session cookie.
let mockCookieValue: string | undefined;
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'app_session' && mockCookieValue !== undefined
        ? { value: mockCookieValue }
        : undefined,
  }),
}));

/** True when `err` is a Next redirect to the login entry. */
function isLoginRedirect(err: unknown): boolean {
  const digest = (err as { digest?: string })?.digest ?? '';
  return digest.startsWith('NEXT_REDIRECT') && digest.includes('/auth/login');
}

/** Runs `fn`, returning the thrown value (or rethrowing if it did not throw). */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}

function seedValidSession(): void {
  sessionStore.create({
    id: 'sess-redirect-test',
    subject: 'test-user',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    idToken: null,
    accessTokenExpiresAt: Date.now() + 600_000,
  });
  mockCookieValue = 'sess-redirect-test';
}

describe('requireSession (data path)', () => {
  beforeEach(() => {
    mockCookieValue = undefined;
    sessionStore.clear?.();
  });

  it('redirects to /auth/login when there is no session', async () => {
    const { requireSession } = await import('@/lib/auth/require-session');
    expect(isLoginRedirect(await captureThrow(() => requireSession()))).toBe(true);
  });

  it('resolves the session when the cookie is valid', async () => {
    seedValidSession();
    const { requireSession } = await import('@/lib/auth/require-session');
    await expect(requireSession()).resolves.toMatchObject({ subject: 'test-user' });
  });

  it('listNotes (what Home renders) degrades to the redirect, not an ApiError', async () => {
    const { listNotes } = await import('@/lib/api');
    expect(isLoginRedirect(await captureThrow(() => listNotes()))).toBe(true);
  });

  it('deleteNoteAction (a server action) degrades to the redirect', async () => {
    const { deleteNoteAction } = await import('@/app/actions');
    expect(isLoginRedirect(await captureThrow(() => deleteNoteAction('note-1')))).toBe(true);
  });
});

describe('BFF flush routes (data path)', () => {
  beforeEach(() => {
    mockCookieValue = undefined;
    sessionStore.clear?.();
  });

  const jsonRequest = () =>
    new Request('http://localhost/api/notes/flush', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', tags: [] }),
    });

  it('POST /api/notes/flush with no session throws the login redirect (not a 502)', async () => {
    const { POST } = await import('@/app/api/notes/flush/route');
    expect(isLoginRedirect(await captureThrow(() => POST(jsonRequest() as never)))).toBe(true);
  });

  it('PATCH /api/notes/:id/flush with no session throws the login redirect (not a 502)', async () => {
    const { PATCH } = await import('@/app/api/notes/[id]/flush/route');
    const err = await captureThrow(() =>
      PATCH(jsonRequest() as never, { params: Promise.resolve({ id: 'note-1' }) }),
    );
    expect(isLoginRedirect(err)).toBe(true);
  });
});
