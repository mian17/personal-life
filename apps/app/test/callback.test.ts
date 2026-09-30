import { resolveCallback, buildExchangeUrl, type CallbackDeps } from '@/lib/auth/callback';
import { encodeLoginAttempt, type LoginAttempt } from '@/lib/auth/login-attempt';
import { SessionStoreUnavailable } from '@/lib/auth/redis-store';
import type { Tokens } from '@/lib/auth/oidc-client';

const ATTEMPT: LoginAttempt = { state: 'state-abc', nonce: 'nonce-xyz', codeVerifier: 'verifier-123' };
const REDIRECT_URI = 'http://127.0.0.1:3002/auth/callback';
const CALLBACK = 'http://localhost:3002/auth/callback?code=CODE&state=state-abc';

function tokens(): Tokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    idToken: 'id.jwt',
    expiresIn: 600,
    subject: 'user-1',
  };
}

function deps(overrides: Partial<CallbackDeps> = {}): CallbackDeps {
  return {
    completeAuthorization: jest.fn().mockResolvedValue(tokens()),
    createSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
    ...overrides,
  } as unknown as CallbackDeps;
}

describe('buildExchangeUrl', () => {
  it('uses the configured redirect URI origin/path and keeps the response query', () => {
    const url = buildExchangeUrl(REDIRECT_URI, CALLBACK);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code')).toBe('CODE');
    expect(url.searchParams.get('state')).toBe('state-abc');
  });
});

describe('GET /auth/callback decision logic (seam-mocked)', () => {
  it('happy path: exchanges, creates a session, and reports success', async () => {
    const completeAuthorization = jest.fn().mockResolvedValue(tokens());
    const createSessionMock = jest.fn().mockResolvedValue({ id: 'session-1' });
    const d = {
      completeAuthorization: completeAuthorization as unknown as CallbackDeps['completeAuthorization'],
      createSession: createSessionMock as unknown as CallbackDeps['createSession'],
    };
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, encodeLoginAttempt(ATTEMPT), d);

    expect(outcome).toEqual({ ok: true, sessionId: 'session-1' });
    expect(completeAuthorization).toHaveBeenCalledTimes(1);
    // The exchange URL is rebuilt from the configured redirect URI (not Next's host).
    const [exchangeUrl, checks] = completeAuthorization.mock.calls[0];
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe(REDIRECT_URI);
    expect(checks).toEqual({ state: ATTEMPT.state, nonce: ATTEMPT.nonce, codeVerifier: ATTEMPT.codeVerifier });
    expect(createSessionMock).toHaveBeenCalledWith(tokens());
  });

  it('surfaces a valid returnTo on success', async () => {
    const d = deps();
    const attempt: LoginAttempt = { ...ATTEMPT, returnTo: '/todos' };
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, encodeLoginAttempt(attempt), d);

    expect(outcome).toEqual({ ok: true, sessionId: 'session-1', returnTo: '/todos' });
  });

  it('drops an unsafe returnTo on success (never surfaces it)', async () => {
    const d = deps();
    const handcrafted = Buffer.from(
      JSON.stringify({ ...ATTEMPT, returnTo: '//evil.com' }),
    ).toString('base64url');
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, handcrafted, d);

    expect(outcome).toEqual({ ok: true, sessionId: 'session-1' });
    expect(outcome).not.toHaveProperty('returnTo');
  });

  it('fails closed with no attempt cookie', async () => {
    const d = deps();
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, undefined, d);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(400);
    expect(d.completeAuthorization).not.toHaveBeenCalled();
    expect(d.createSession).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed attempt cookie', async () => {
    const d = deps();
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, 'not-base64-json', d);
    expect(outcome.ok).toBe(false);
    expect(d.createSession).not.toHaveBeenCalled();
  });

  it('maps a session-store outage on createSession to a clean failure (no 500)', async () => {
    const d = deps({
      createSession: jest
        .fn()
        .mockRejectedValue(new SessionStoreUnavailable(new Error('redis unavailable'))),
    });
    const outcome = await resolveCallback(CALLBACK, REDIRECT_URI, encodeLoginAttempt(ATTEMPT), d);

    // `createSession` threw rather than returning a half-issued session; the
    // callback reports the same clean retryable failure as a denied login.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe(400);
      expect(outcome.message).not.toContain('SessionStoreUnavailable');
    }
  });

  it('fails closed with no session when the exchange throws (state/nonce/verifier mismatch)', async () => {
    const d = deps({
      completeAuthorization: jest.fn().mockRejectedValue(new Error('state mismatch')),
    });
    const badState = 'http://localhost:3002/auth/callback?code=CODE&state=WRONG';
    const outcome = await resolveCallback(badState, REDIRECT_URI, encodeLoginAttempt(ATTEMPT), d);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(400);
    expect(d.createSession).not.toHaveBeenCalled();
  });

  it('fails closed when the IdP reports an authorization error', async () => {
    const d = deps();
    const errorUrl = 'http://localhost:3002/auth/callback?error=access_denied&state=state-abc';
    const outcome = await resolveCallback(errorUrl, REDIRECT_URI, encodeLoginAttempt(ATTEMPT), d);
    expect(outcome.ok).toBe(false);
    expect(d.completeAuthorization).not.toHaveBeenCalled();
    expect(d.createSession).not.toHaveBeenCalled();
  });

  it('fails closed when the callback has no code', async () => {
    const d = deps();
    const noCode = 'http://localhost:3002/auth/callback?state=state-abc';
    const outcome = await resolveCallback(noCode, REDIRECT_URI, encodeLoginAttempt(ATTEMPT), d);
    expect(outcome.ok).toBe(false);
    expect(d.createSession).not.toHaveBeenCalled();
  });
});

describe('login-attempt cookie payload', () => {
  it('round-trips the state, nonce, and verifier', async () => {
    const { decodeLoginAttempt } = await import('@/lib/auth/login-attempt');
    expect(decodeLoginAttempt(encodeLoginAttempt(ATTEMPT))).toEqual(ATTEMPT);
  });
});
