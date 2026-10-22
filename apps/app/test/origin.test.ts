import {
  canonicalizeLoopbackHost,
  canonicalizeLoopbackUrl,
  isLoopbackHost,
  loopbackCanonicalHop,
  requestOrigin,
} from '@/lib/auth/origin';

/**
 * Loopback canonicalization is the fix for the dev "loopback cookie split":
 * Next's middleware adapter rewrites the loopback host in every redirect
 * Location to `localhost`, so the browser (and thus the attempt cookie) always
 * ends up there. The app must build redirects on that same host or the callback
 * lands on a host without the cookie and fails closed with 400.
 */

function req(headers: Record<string, string>, fallbackOrigin = 'http://internal:9999') {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    nextUrl: { origin: fallbackOrigin },
  };
}

describe('isLoopbackHost', () => {
  it('recognizes every loopback spelling, with or without brackets', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.0.0.2']) {
      if (host === '127.0.0.2') continue; // not the loopback alias Next normalizes
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ['host.example.ts.net', '10.0.0.5', '127.0.0.2']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('canonicalizeLoopbackHost', () => {
  it('maps 127.0.0.1 / [::1] to localhost and leaves real hosts alone', () => {
    expect(canonicalizeLoopbackHost('127.0.0.1')).toBe('localhost');
    expect(canonicalizeLoopbackHost('[::1]')).toBe('localhost');
    expect(canonicalizeLoopbackHost('localhost')).toBe('localhost');
    expect(canonicalizeLoopbackHost('host.example.ts.net')).toBe('host.example.ts.net');
  });
});

describe('canonicalizeLoopbackUrl', () => {
  it('rewrites only the loopback host, preserving scheme/port/path/query', () => {
    expect(canonicalizeLoopbackUrl('http://127.0.0.1:3000/auth/callback?x=1')).toBe(
      'http://localhost:3000/auth/callback?x=1',
    );
    expect(canonicalizeLoopbackUrl('http://[::1]:3000/auth/callback')).toBe(
      'http://localhost:3000/auth/callback',
    );
  });

  it('leaves a non-loopback (production) URL byte-identical', () => {
    const prod = 'https://host.example.ts.net/auth/callback';
    expect(canonicalizeLoopbackUrl(prod)).toBe(prod);
  });
});

describe('requestOrigin', () => {
  it('uses the Host header and canonicalizes a loopback host', () => {
    expect(requestOrigin(req({ host: '127.0.0.1:3000' }))).toBe('http://localhost:3000');
    expect(requestOrigin(req({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });

  it('honours x-forwarded-* and never normalizes a real host (production)', () => {
    expect(
      requestOrigin(req({ 'x-forwarded-host': 'host.example.ts.net', 'x-forwarded-proto': 'https' })),
    ).toBe('https://host.example.ts.net');
    // A comma-separated forwarded host uses the first entry.
    expect(
      requestOrigin(
        req({ 'x-forwarded-host': 'host.example.ts.net, proxy.local', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://host.example.ts.net');
  });

  it('falls back to nextUrl.origin when there is no host header', () => {
    expect(requestOrigin(req({}))).toBe('http://internal:9999');
  });
});

describe('loopbackCanonicalHop', () => {
  // Next emits a *relative* Location when the redirect targets the same origin,
  // so canonicalizing the host is not enough: the browser stays on `127.0.0.1`,
  // the attempt cookie lands there, and the IdP's callback to `localhost` cannot
  // read it. These pin the hop that actually moves the browser.
  it('moves a 127.0.0.1 browser to localhost, preserving path and returnTo', () => {
    const hop = loopbackCanonicalHop(
      req({ host: '127.0.0.1:3200' }),
      '/auth/login?returnTo=%2Fnotes',
    );
    expect(hop?.toString()).toBe('http://localhost:3200/auth/login?returnTo=%2Fnotes');
  });

  it('moves an IPv6 loopback browser to localhost', () => {
    expect(loopbackCanonicalHop(req({ host: '[::1]:3200' }), '/auth/login')?.hostname).toBe(
      'localhost',
    );
  });

  it('does not hop a browser that is already on localhost', () => {
    expect(loopbackCanonicalHop(req({ host: 'localhost:3200' }), '/auth/login')).toBeNull();
  });

  it('never hops a non-loopback (production / Tailscale) host', () => {
    expect(loopbackCanonicalHop(req({ host: 'life.example.ts.net' }), '/auth/login')).toBeNull();
  });

  it('does not hop when there is no host header at all', () => {
    expect(loopbackCanonicalHop(req({}), '/auth/login')).toBeNull();
  });
});
