/**
 * `/auth/login` must degrade honestly when the IdP is unreachable: a small 503
 * page, not a raw 500 with a fetch stack. It must also carry a validated
 * `returnTo` (from `?returnTo=`) inside the per-attempt cookie: a local path is
 * kept, an off-origin value is dropped. The OIDC client is mocked at its seam
 * so no network is involved.
 */

jest.mock('@/lib/auth/oidc-client', () => ({
  buildAuthorizationRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { buildAuthorizationRequest } from '@/lib/auth/oidc-client';
import { GET } from '@/app/auth/login/route';
import { LOGIN_ATTEMPT_COOKIE, decodeLoginAttempt, type LoginAttempt } from '@/lib/auth/login-attempt';

const mockedBuild = buildAuthorizationRequest as jest.MockedFunction<typeof buildAuthorizationRequest>;

const ATTEMPT = {
  url: 'http://127.0.0.1:3003/auth?state=s',
  state: 's',
  nonce: 'n',
  codeVerifier: 'v',
};

function request(path: string = '/auth/login'): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

/** Value of the attempt cookie set on the response, decoded to an object. */
function attemptCookie(res: Response): LoginAttempt | undefined {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(new RegExp(`${LOGIN_ATTEMPT_COOKIE}=([^;]+)`));
  return match ? decodeLoginAttempt(match[1]) : undefined;
}

describe('GET /auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirects to the IdP and sets the attempt cookie on the happy path', async () => {
    mockedBuild.mockResolvedValue(ATTEMPT);
    const res = await GET(request());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('127.0.0.1:3003/auth');
    expect(res.headers.get('set-cookie')).toContain('app_auth_attempt=');
  });

  it('returns a 503 "identity service unavailable" page when the IdP is unreachable', async () => {
    mockedBuild.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Identity service unavailable');
    // No attempt cookie is set on the failure path.
    expect(res.headers.get('set-cookie') ?? '').not.toContain('app_auth_attempt=');
  });

  it('stores a valid local returnTo in the attempt cookie', async () => {
    mockedBuild.mockResolvedValue(ATTEMPT);
    const res = await GET(request('/auth/login?returnTo=%2Ftodos'));
    expect(res.status).toBe(303);
    expect(attemptCookie(res)).toEqual({
      state: 's',
      nonce: 'n',
      codeVerifier: 'v',
      returnTo: '/todos',
    });
  });

  it('drops an off-origin returnTo from the attempt cookie', async () => {
    mockedBuild.mockResolvedValue(ATTEMPT);
    const res = await GET(request('/auth/login?returnTo=https%3A%2F%2Fevil.com'));
    expect(res.status).toBe(303);
    const decoded = attemptCookie(res);
    expect(decoded).toEqual({ state: 's', nonce: 'n', codeVerifier: 'v' });
    expect(decoded).not.toHaveProperty('returnTo');
  });
});
