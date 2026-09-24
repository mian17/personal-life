/**
 * The externally-visible origin of a request.
 *
 * Next's `req.nextUrl`/`req.url` are built from the server's internal bind
 * hostname, which is `localhost` even when the request arrived on a different
 * host (verified in the standalone server: a request to 127.0.0.1:3100 reports
 * `http://localhost:3100`). Using it for redirects would move the browser to a
 * different origin, so cookies set on the real host would not be sent back.
 *
 * We therefore reconstruct the origin from the forwarded headers (set by
 * Tailscale Serve / proxies) or the Host header, which reflect what the browser
 * actually used (and what the IdP registered as the redirect URI).
 */

export interface HeaderCarrier {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string };
}

export function requestOrigin(req: HeaderCarrier): string {
  const proto = firstHeader(req.headers.get('x-forwarded-proto')) ?? 'http';
  const forwardedHost = firstHeader(req.headers.get('x-forwarded-host'));
  const host = forwardedHost ?? firstHeader(req.headers.get('host'));
  if (!host) return req.nextUrl.origin;
  return `${proto}://${host}`;
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
