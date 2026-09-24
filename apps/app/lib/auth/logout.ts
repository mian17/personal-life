import 'server-only';

/**
 * The IdP logout URL. The IdP exposes `POST /logout` (decision B revokes grants
 * there), so callers must reach it with a method-preserving redirect (307) or a
 * form POST — never a plain 303/GET redirect.
 */
export function buildIdpLogoutUrl(issuer: string): URL {
  return new URL('/logout', issuer);
}
