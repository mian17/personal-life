/**
 * Pure middleware gate decision logic. Kept free of Next/DOM types so it is
 * trivially unit-testable; `middleware.ts` adapts a `NextRequest` into this
 * shape. Two independent concerns, in order:
 *
 *  1. ACCESS (Tailscale): only the owner's device may reach the app. Identity is
 *     NOT derived from this — it is purely reachability.
 *  2. IDENTITY (IdP): a valid app session is required; otherwise start the login
 *     dance. Who the user is comes only from the IdP-backed session.
 */

export type GateDecision = 'next' | 'forbidden' | 'redirect-login';

/** Paths that must be reachable without a session (they start or finish login). */
const PUBLIC_PREFIXES = ['/auth/'];
/** Public static assets not worth gating (the app HTML only renders when authed). */
const PUBLIC_EXACT = new Set(['/favicon.ico', '/manifest.json', '/icon.svg']);
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface GateInput {
  /** Whether this is a production-style run (dev skips the whole gate). */
  isProduction: boolean;
  pathname: string;
  /** Tailscale/Serve traffic marker (Next sets this in production). */
  hasForwardedHost: boolean;
  /** The `tailscale-user-login` header, if any. */
  tailscaleLogin: string | null;
  /** The configured owner login (env). */
  ownerLogin: string | undefined;
  /** Whether the request carries a live app session. */
  hasValidSession: boolean;
}

export function decideGate(input: GateInput): GateDecision {
  // Dev skips the gate entirely (existing convention) so localhost works without
  // the Tailscale header or an IdP round-trip.
  if (!input.isProduction) return 'next';

  // 1. Access gate — unchanged Tailscale semantics: header-less local traffic is
  // allowed; proxied traffic must carry the owner's login.
  if (input.hasForwardedHost) {
    const owner = input.ownerLogin;
    const login = input.tailscaleLogin;
    if (!owner || !login || login.toLowerCase() !== owner.toLowerCase()) {
      return 'forbidden';
    }
  }

  // 2. Identity gate — start/finish login paths and public assets pass through.
  if (isPublicPath(input.pathname)) return 'next';
  return input.hasValidSession ? 'next' : 'redirect-login';
}
