import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PKCE (RFC 7636) and CSRF/`nonce` primitives. We use `node:crypto` directly —
 * standard primitives only, no hand-rolled crypto — and keep these pure so they
 * are unit-testable without any network or provider.
 */

/** A PKCE `code_verifier` per RFC 7636 §4.1: 43–128 chars from the unreserved set. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 `code_challenge` for a verifier (base64url(SHA-256(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Opaque random tokens for `state` and `nonce`. */
export function createState(): string {
  return randomBytes(16).toString('base64url');
}

export function createNonce(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Constant-time comparison for the callback's `state` check. Length is not
 * secret, so a length mismatch can fail fast; equal-length inputs compare in
 * constant time. Returns false for missing values.
 */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
