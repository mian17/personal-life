/**
 * The repo's one dev-stack marker, read where a cookie is written rather than
 * inside the cookie helper: an env read inside a helper is invisible to a
 * bundler that inlines it, which is how the app's `dev:build` froze
 * `NODE_ENV=production` into a dev run.
 *
 * `APP_DEV_SKIP_ACCESS_GATE=1` skips the Tailscale ACCESS gate and drops
 * `Secure` from every cookie this repo writes. Anything else — unset, empty,
 * `true`, `0` — is a deployed stack and stays secure, so a forgotten flag fails
 * closed rather than shipping session cookies over plain http.
 */
export function secureCookie(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_DEV_SKIP_ACCESS_GATE !== '1';
}
