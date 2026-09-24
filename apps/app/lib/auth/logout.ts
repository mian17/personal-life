import 'server-only';

/**
 * The IdP logout URL. The IdP exposes `POST /logout` for the actual revocation
 * (decision B) and a side-effect-free `GET /logout` landing page whose only job
 * is to auto-POST to it from the IdP's own origin — so the IdP session cookie is
 * always attached (a cross-site POST to the IdP would not carry a SameSite=Lax
 * cookie). Callers redirect here with a plain top-level GET navigation.
 */
export function buildIdpLogoutUrl(issuer: string): URL {
  return new URL('/logout', issuer);
}
