import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/**
 * Bearer-JWT verification for this resource server. Tokens are verified
 * offline against the IdP's JWKS — signature, `iss`, `aud`, and `exp` — with a
 * 30s clock skew (recorded decision). Any doubt fails closed.
 *
 * Key rotation is handled by `jose`: the cached key set is refreshed when a
 * token's `kid` is unknown, bounded by a cooldown so an attacker cannot force
 * unbounded refetches (see createRemoteJWKSet docs — `cacheMaxAge` default
 * 10min, `cooldownDuration` default 30s).
 */

export interface VerifierConfig {
  issuer: string;
  jwksUrl: string;
  audience: string;
  /** Clock-skew tolerance in seconds (recorded decision: 30). */
  clockToleranceS: number;
  /** Max age of a cached key set in ms (default 10 min, per jose). */
  jwksCacheMaxAgeMs: number;
  /** Min ms after a successful fetch before an unknown kid may trigger another (default 30s, per jose). */
  jwksCooldownMs: number;
}

export function resolveVerifierConfig(env: NodeJS.ProcessEnv = process.env): VerifierConfig {
  const issuer = env.IDP_ISSUER?.trim();
  if (!issuer) {
    throw new Error('IDP_ISSUER is not set');
  }
  // MEAL_IDP_JWKS_URL overrides the default `<IDP_ISSUER>/jwks` derivation.
  const jwksUrl = env.MEAL_IDP_JWKS_URL?.trim() || new URL('/jwks', issuer).href;
  return {
    issuer,
    jwksUrl,
    audience: env.MEAL_SERVICE_AUDIENCE?.trim() || 'life-api',
    clockToleranceS: 30,
    jwksCacheMaxAgeMs: Number(env.IDP_JWKS_CACHE_MAX_AGE_MS ?? 10 * 60 * 1000),
    jwksCooldownMs: Number(env.IDP_JWKS_COOLDOWN_MS ?? 30 * 1000),
  };
}

/** A JWKS resolver built from config; injectable so tests can supply their own. */
export type JwksResolver = JWTVerifyGetKey;

export function createJwksResolver(config: VerifierConfig): JwksResolver {
  return createRemoteJWKSet(new URL(config.jwksUrl), {
    cacheMaxAge: config.jwksCacheMaxAgeMs,
    // Bounds refetches: an unknown kid triggers at most one fetch per cooldown,
    // so a hostile `kid` cannot force unbounded JWKS requests.
    cooldownDuration: config.jwksCooldownMs,
  });
}

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/**
 * Verifies a bearer JWT and returns its claims. Throws `TokenVerificationError`
 * on any failure (bad signature, `iss`/`aud` mismatch, expired, malformed, JWKS
 * unreachable) — callers map that to 401 and never leak the cause.
 */
export async function verifyAccessToken(
  jwt: string,
  resolver: JwksResolver,
  config: VerifierConfig,
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(jwt, resolver, {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: config.clockToleranceS,
      // Only asymmetric EdDSA tokens are issued; `alg: none` is never accepted.
      algorithms: ['EdDSA'],
    });
    return payload;
  } catch (err) {
    // Fail closed: any jose error (or unexpected error) is a verification doubt.
    const detail =
      err instanceof errors.JOSEError ? `${err.code}: ${err.message}` : 'verification failed';
    throw new TokenVerificationError(detail);
  }
}