/**
 * `GET /auth/callback` must land the browser on the validated `returnTo` path
 * carried in the attempt cookie, falling back to `/` (→ `/notes`) when absent.
 * The OIDC client and session seams are mocked: no network, no store. The
 * `completeAuthorization` mock validates `state` like the real client, so a
 * tampered callback fails closed with a 400 and no session.
 */

jest.mock('@/lib/auth/oidc-client', () => ({
  completeAuthorization: jest.fn(),
}));

jest.mock('@/lib/auth/session', () => ({
  createSession: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/auth/callback/route';
import { completeAuthorization } from '@/lib/auth/oidc-client';
import { createSession } from '@/lib/auth/session';
import { encodeLoginAttempt, LOGIN_ATTEMPT_COOKIE, type LoginAttempt } from '@/lib/auth/login-attempt';

const mockedComplete = completeAuthorization as jest.MockedFunction<typeof completeAuthorization>;
const mockedCreate = createSession as jest.MockedFunction<typeof createSession>;

const ATTEMPT: LoginAttempt = { state: 's', nonce: 'n', codeVerifier: 'v' };
const CALLBACK = 'http://localhost/auth/callback?code=CODE&state=s';

function tokens() {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: 'id.jwt',
    expiresIn: 600,
    subject: 'user-1',
  };
}

function request(url: string, attemptCookie?: string): NextRequest {
  return new NextRequest(
    url,
    attemptCookie ? { headers: { cookie: `${LOGIN_ATTEMPT_COOKIE}=${attemptCookie}` } } : {},
  );
}

function locationPath(res: Response): string {
  return new URL(res.headers.get('location') ?? '').pathname;
}

describe('GET /auth/callback route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors the real client's `expectedState` check: a tampered state throws.
    mockedComplete.mockImplementation(async (url, checks) => {
      if (url.searchParams.get('state') !== checks.state) throw new Error('state mismatch');
      return tokens();
    });
    mockedCreate.mockResolvedValue({ id: 'session-1' } as never);
  });

  it('redirects to returnTo from the attempt cookie (303)', async () => {
    const res = await GET(request(CALLBACK, encodeLoginAttempt({ ...ATTEMPT, returnTo: '/todos' })));

    expect(res.status).toBe(303);
    expect(locationPath(res)).toBe('/todos');
    expect(res.headers.get('set-cookie') ?? '').toContain('app_session=session-1');
  });

  it('falls back to "/" when the attempt has no returnTo (303)', async () => {
    const res = await GET(request(CALLBACK, encodeLoginAttempt(ATTEMPT)));

    expect(res.status).toBe(303);
    expect(locationPath(res)).toBe('/');
  });

  it('fails closed with 400 and no session on a tampered state', async () => {
    const res = await GET(
      request('http://localhost/auth/callback?code=CODE&state=TAMPERED', encodeLoginAttempt(ATTEMPT)),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('app_session=');
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
