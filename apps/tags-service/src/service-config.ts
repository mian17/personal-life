import type { VerifierEnvNames } from '@life/service-kit';

/** The env var names this service feeds into the shared JWT verifier. */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'TAGS_IDP_JWKS_URL',
  audienceEnv: 'TAGS_SERVICE_AUDIENCE',
};

/** Env var holding this service's base64 32-byte master key (fail-closed). */
export const MASTER_KEY_ENV = 'TAGS_MASTER_KEY';
