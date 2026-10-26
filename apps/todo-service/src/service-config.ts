import type { VerifierEnvNames } from '@life/service-kit';

/**
 * This service's env var names for the shared `@life/service-kit` layers.
 * `AuthGuard` and `createMasterKey` take the names, so one shared implementation
 * serves every service without a per-service copy.
 */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'TODO_IDP_JWKS_URL',
  audienceEnv: 'TODO_SERVICE_AUDIENCE',
};

/** Env var holding this service's base64 32-byte master key (fail-closed). */
export const MASTER_KEY_ENV = 'TODO_MASTER_KEY';
