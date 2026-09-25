/**
 * The externally-visible origin of a request, and the app's own canonical origin.
 *
 * Next's `req.nextUrl`/`req.url` are built from the server's internal bind
 * hostname, which is `localhost` even when the request arrived on a different
 * host. Using it for redirects would move the browser to a different origin, so
 * cookies set on the real host would not be sent back.
 *
 * We reconstruct the origin from the forwarded headers (set by Tailscale Serve /
 * proxies) or the Host header, which reflect what the browser actually used.
 *
 * **Loopback canonicalization.** Next's middleware adapter rewrites the loopback
 * host in every middleware redirect Location (`127.0.0.1`/`[::1]`/`localhost` →
 * `localhost`, see `next/dist/server/web/adapter.js` + `next-url.js`). So in dev
 * the browser is always moved to `localhost`, while our Host header may say
 * `127.0.0.1`. Returning the raw header would then set cookies on `127.0.0.1`
 * that the `localhost` callback never sends — the "loopback cookie split" that
 * broke `GET /auth/callback` with `400 missing or invalid auth attempt`.
 *
 * The browser's real, post-normalization origin is therefore `localhost` for any
 * loopback spelling, so we canonicalize loopback hosts to it. Non-loopback hosts
 * (Tailscale Serve, a real domain) are never touched, so production is unchanged.
 */

export interface HeaderCarrier {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string };
}

/** True for the hostnames the Next runtime treats as interchangeable loopback. */
export function isLoopbackHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '');
  return bare === '127.0.0.1' || bare === '::1' || bare === 'localhost';
}

/**
 * The loopback spelling the browser will actually be on after Next's middleware
 * normalization: `localhost`. Non-loopback hosts are returned unchanged.
 */
export function canonicalizeLoopbackHost(hostname: string): string {
  return isLoopbackHost(hostname) ? 'localhost' : hostname;
}

/** Canonicalize the host of an absolute URL in place-safe fashion (returns a new URL). */
export function canonicalizeLoopbackUrl(value: string): string {
  const url = new URL(value);
  if (isLoopbackHost(url.hostname)) {
    url.hostname = 'localhost';
  }
  return url.toString();
}

export function requestOrigin(req: HeaderCarrier): string {
  const proto = firstHeader(req.headers.get('x-forwarded-proto')) ?? 'http';
  const forwardedHost = firstHeader(req.headers.get('x-forwarded-host'));
  const host = forwardedHost ?? firstHeader(req.headers.get('host'));
  if (!host) return req.nextUrl.origin;
  const url = new URL(`${proto}://${host}`);
  // Keep the browser on the host it will actually be on after any middleware hop.
  url.hostname = canonicalizeLoopbackHost(url.hostname);
  return url.origin;
}

/** Build an absolute URL on the request's external origin. */
export function absoluteUrl(req: HeaderCarrier, path: string): URL {
  return new URL(path, requestOrigin(req));
}

function firstHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}
