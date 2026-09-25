/**
 * `/auth/login` must degrade honestly when the IdP is unreachable: a small 503
 * page, not a raw 500 with a fetch stack. The OIDC client is mocked at its seam
 * so no network is involved.
 */

jest.mock('@/lib/auth/oidc-client', () => ({
  buildAuthorizationRequest: jest.fn(),
}));

import { buildAuthorizationRequest } from '@/lib/auth/oidc-client';
import { GET } from '@/app/auth/login/route';

const mockedBuild = buildAuthorizationRequest as jest.MockedFunction<typeof buildAuthorizationRequest>;

function request(): Request {
  return new Request('http://localhost/auth/login');
}

describe('GET /auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirects to the IdP and sets the attempt cookie on the happy path', async () => {
    mockedBuild.mockResolvedValue({
      url: 'http://127.0.0.1:3003/auth?state=s',
      state: 's',
      nonce: 'n',
      codeVerifier: 'v',
    });
    const res = await GET(request() as never);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('127.0.0.1:3003/auth');
    expect(res.headers.get('set-cookie')).toContain('app_auth_attempt=');
  });

  it('returns a 503 "identity service unavailable" page when the IdP is unreachable', async () => {
    mockedBuild.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(request() as never);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Identity service unavailable');
    // No attempt cookie is set on the failure path.
    expect(res.headers.get('set-cookie') ?? '').not.toContain('app_auth_attempt=');
  });
});
