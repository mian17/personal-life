import { readFileSync } from 'node:fs';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { JSONWebKeySet } from 'jose';

/**
 * Standalone JWKS verifier: proves an access token verifies against the fetched
 * JWKS document alone, with no call back to the IdP.
 *
 *   node scripts/verify-jwks.ts --token <jwt> --jwks-file <keys.json> [--iss <issuer>] [--aud <aud>]
 *   node scripts/verify-jwks.ts --token <jwt> --jwks-url http://127.0.0.1:3003/jwks
 *
 * Exits 0 and prints the verified claims, or exits non-zero on any failure.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadJwks(): Promise<JSONWebKeySet> {
  const file = arg('--jwks-file');
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as JSONWebKeySet;

  const url = arg('--jwks-url');
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch JWKS (${res.status})`);
    return (await res.json()) as JSONWebKeySet;
  }

  throw new Error('provide --jwks-file or --jwks-url');
}

async function main(): Promise<void> {
  const token = arg('--token');
  if (!token) throw new Error('provide --token');

  const jwks = await loadJwks();
  const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: arg('--iss'),
    audience: arg('--aud'),
  });

  // Tokens/claims are safe to print; this is a verification helper, not a log.
  console.log(
    'verified:',
    JSON.stringify({
      alg: protectedHeader.alg,
      kid: protectedHeader.kid,
      sub: payload.sub,
      aud: payload.aud,
      iss: payload.iss,
      exp: payload.exp,
    }),
  );
}

main().catch((err: unknown) => {
  console.error('verification failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
