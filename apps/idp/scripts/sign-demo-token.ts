import { loadOrCreateKeySet, signJwt } from '../src/crypto/signing-keys.js';
import { resolveKeysPath } from '../src/crypto/signing-key.service.js';
import { ACCESS_TOKEN_TTL_S, audienceFor } from '../src/oidc/access-token.policy.js';

/**
 * Dev-only helper: signs a short-lived, audience-scoped access token with the
 * persisted signing key so the standalone JWKS verifier can be exercised before
 * the OIDC token flow lands (Task 5). Prints the token to stdout only.
 *
 *   node scripts/sign-demo-token.ts --subject me --audience note-service
 */
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const subject = arg('--subject') ?? 'demo-user';
const audience = audienceFor(arg('--audience') ?? 'note-service');
const issuer = process.env.IDP_ISSUER ?? 'http://127.0.0.1:3003';

const now = Math.floor(Date.now() / 1000);
const token = signJwt(
  { iss: issuer, sub: subject, aud: audience, iat: now, exp: now + ACCESS_TOKEN_TTL_S },
  loadOrCreateKeySet(resolveKeysPath()),
);

console.log(token);
