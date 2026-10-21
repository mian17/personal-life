import { decideGate, isPublicPath } from '@/lib/auth/gate';

const base = {
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

  it('defaults the gate on: an omitted flag keeps a proxied request fail-closed', () => {
    // No `NODE_ENV` input exists any more — an omitted `accessGate` must gate.
    expect(
      decideGate({
        ...base,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: null,
        hasValidSession: true,
      }),
    ).toBe('forbidden');
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
        pathname: '/todos',
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
        tailscaleLogin: 'someone-else@example.com',
        hasValidSession: true,
      }),
    ).toBe('forbidden');
  });

  it('runs in the dev stack too: the flag never skips identity', () => {
    // `APP_DEV_SKIP_ACCESS_GATE=1` reaches `decideGate` as `accessGate: false`.
    // ACCESS is skipped, identity is not: a cold request still starts login, and
    // a mismatched owner header cannot stand in for a session.
    expect(
      decideGate({ ...base, accessGate: false, hasForwardedHost: true, hasValidSession: false }),
    ).toBe('redirect-login');
    expect(
      decideGate({
        ...base,
        accessGate: false,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: 'intruder@example.com',
        hasValidSession: false,
      }),
    ).toBe('redirect-login');
    expect(
      decideGate({
        ...base,
        accessGate: false,
        hasForwardedHost: true,
        ownerLogin: 'owner@example.com',
        tailscaleLogin: null,
        hasValidSession: true,
      }),
    ).toBe('next');
  });
});

describe('public paths', () => {
  it('exempts the auth routes and static assets', () => {
    for (const p of [
      '/auth/login',
      '/auth/callback',
      '/auth/logout',
      '/manifest-notes.json',
      '/manifest-todos.json',
      '/manifest-feedback.json',
      '/manifest-meals.json',
      '/icon-notes.png',
      '/icon-todos.png',
      '/icon-feedback.png',
      '/icon-meals.png',
      '/icon.svg',
      '/favicon.ico',
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('does not exempt app content or the BFF', () => {
    for (const p of ['/', '/notes/trash', '/notes/new', '/api/notes/flush', '/notes/abc']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
