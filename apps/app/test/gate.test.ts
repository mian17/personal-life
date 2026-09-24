import { decideGate, isPublicPath } from '@/lib/auth/gate';

const base = {
  isProduction: true,
  pathname: '/',
  hasForwardedHost: false,
  tailscaleLogin: null,
  ownerLogin: undefined as string | undefined,
  hasValidSession: false,
};

describe('access gate (Tailscale, access-only)', () => {
  it('allows header-less local traffic regardless of owner config', () => {
    expect(decideGate({ ...base, hasForwardedHost: false })).toBe('redirect-login');
  });

  it('forbids proxied traffic without the owner header', () => {
    const d = decideGate({
      ...base,
      hasForwardedHost: true,
      ownerLogin: 'owner@example.com',
      tailscaleLogin: null,
      hasValidSession: true,
    });
    expect(d).toBe('forbidden');
  });

  it('forbids proxied traffic for a different login', () => {
    const d = decideGate({
      ...base,
      hasForwardedHost: true,
      ownerLogin: 'owner@example.com',
      tailscaleLogin: 'someone-else@example.com',
      hasValidSession: true,
    });
    expect(d).toBe('forbidden');
  });

  it('allows proxied traffic from the owner', () => {
    const d = decideGate({
      ...base,
      hasForwardedHost: true,
      ownerLogin: 'Owner@Example.com',
      tailscaleLogin: 'owner@example.com',
      hasValidSession: true,
    });
    expect(d).toBe('next');
  });
});

describe('identity gate (IdP session)', () => {
  it('redirects to login when there is no session', () => {
    expect(decideGate({ ...base, pathname: '/', hasValidSession: false })).toBe('redirect-login');
  });

  it('passes through with a valid session', () => {
    expect(decideGate({ ...base, pathname: '/', hasValidSession: true })).toBe('next');
  });

  it('never derives identity from the Tailscale header (403 comes before the session check)', () => {
    // A valid-looking header cannot substitute for a session, and a session
    // cannot bypass the access gate.
    expect(
      decideGate({
        ...base,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: 'owner@example.com',
        hasValidSession: false,
      }),
    ).toBe('redirect-login');
    expect(
      decideGate({
        ...base,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: 'intruder@example.com',
        hasValidSession: true,
      }),
    ).toBe('forbidden');
  });
});

describe('public paths', () => {
  it('exempts the auth routes and static assets', () => {
    for (const p of ['/auth/login', '/auth/callback', '/auth/logout', '/manifest.json', '/icon.svg', '/favicon.ico']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('does not exempt app content or the BFF', () => {
    for (const p of ['/', '/trash', '/notes/new', '/api/notes/flush', '/notes/abc']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe('dev skip', () => {
  it('skips the whole gate in development', () => {
    expect(decideGate({ ...base, isProduction: false, hasValidSession: false })).toBe('next');
    expect(
      decideGate({
        ...base,
        isProduction: false,
        hasForwardedHost: true,
        tailscaleLogin: null,
      }),
    ).toBe('next');
  });
});
