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
    for (const p of ['/', '/notes/trash', '/notes/new', '/api/notes/flush', '/notes/abc']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe('dev (non-production) gate', () => {
  it('still enforces the identity gate: no session → redirect-login', () => {
    // The dev-skip covers the ACCESS gate only. The identity gate runs everywhere,
    // so a cold dev request is sent to login instead of hitting the data layer.
    expect(
      decideGate({ ...base, isProduction: false, pathname: '/', hasValidSession: false }),
    ).toBe('redirect-login');
  });

  it('passes with a valid session in dev', () => {
    expect(
      decideGate({ ...base, isProduction: false, pathname: '/', hasValidSession: true }),
    ).toBe('next');
  });

  it('exempts public paths in dev', () => {
    expect(
      decideGate({ ...base, isProduction: false, pathname: '/auth/login', hasValidSession: false }),
    ).toBe('next');
  });

  it('retains the access-gate skip: dev traffic is never forbidden', () => {
    // Dev has no Tailscale header and Next always injects x-forwarded-host; the
    // skip is load-bearing, so even a forwarded host with a mismatched owner is
    // allowed through to the identity gate.
    expect(
      decideGate({
        ...base,
        isProduction: false,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: null,
        hasValidSession: true,
      }),
    ).toBe('next');
    expect(
      decideGate({
        ...base,
        isProduction: false,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: 'intruder@example.com',
        hasValidSession: false,
      }),
    ).toBe('redirect-login');
  });
});
