/**
 * Pure middleware gate decision logic. Kept free of Next/DOM types so it is
 * trivially unit-testable; `middleware.ts` adapts a `NextRequest` into this
 * shape. Two independent concerns, evaluated in order:
 *
 *  1. ACCESS (Tailscale): only the owner's device may reach the app. Identity is
 *     NOT derived from this — it is purely reachability. This is the only gate
 *     that is ever switched off, and the switch is the dev-stack flag
 *     (`APP_DEV_SKIP_ACCESS_GATE=1`), not `NODE_ENV`: `next build` forces
 *     production on the dev stack too, so `NODE_ENV` cannot mark it.
 *  2. IDENTITY (IdP): a valid app session is required; otherwise start the login
 *     dance. Who the user is comes only from the IdP-backed session. This runs
 *     in **every** environment — localhost is no exception.
 */

export type GateDecision = 'next' | 'forbidden' | 'redirect-login';

/** Paths that must be reachable without a session (they start or finish login). */
const PUBLIC_PREFIXES = ['/auth/'];
/** Public static assets not worth gating (the app HTML only renders when authed). */
const PUBLIC_EXACT = new Set([
  '/favicon.ico',
  '/manifest-notes.json',
  '/manifest-todos.json',
  '/manifest-feedback.json',
  '/manifest-meals.json',
  '/icon-notes.png',
  '/icon-todos.png',
  '/icon-feedback.png',
  '/icon-meals.png',
  '/icon.svg',
]);
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface GateInput {
  /**
   * Whether the Tailscale ACCESS gate runs at all. Defaults to `true` when
   * omitted, so every caller and test keeps the fail-closed behavior.
   * `middleware.ts` passes `false` only when `APP_DEV_SKIP_ACCESS_GATE=1` — the
   * one dev-stack switch. A `dev:build` run needs it because `next start` forces
   * `NODE_ENV=production` on its process and would otherwise 403 header-less
   * localhost. The opt-out is a command-line flag, never a deployed env value.
   */
  accessGate?: boolean;
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
  // 1. ACCESS gate. `accessGate` defaults on, so a caller that omits it (or a
  // deployed process) is fail-closed. Header-less local traffic stays reachable:
  // on the dev stack the flag disables this gate, and a direct loopback request
  // carries no `x-forwarded-host`.
  if ((input.accessGate ?? true) && input.hasForwardedHost) {
    const owner = input.ownerLogin;
    const login = input.tailscaleLogin;
    if (!owner || !login || login.toLowerCase() !== owner.toLowerCase()) {
      return 'forbidden';
    }
  }

  // 2. IDENTITY gate — runs in every environment. Start/finish login paths and
  // public assets pass through; everything else needs a valid session.
  if (isPublicPath(input.pathname)) return 'next';
  return input.hasValidSession ? 'next' : 'redirect-login';
}
