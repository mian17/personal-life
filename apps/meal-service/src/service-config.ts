import type { VerifierEnvNames } from '@life/service-kit';

/** The env var names meal-service feeds into the shared JWT verifier. */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'MEAL_IDP_JWKS_URL',
  audienceEnv: 'MEAL_SERVICE_AUDIENCE',
};

/** Env var holding the base64 32-byte master key (fail-closed bootstrap). */
export const MASTER_KEY_ENV = 'MEAL_MASTER_KEY';
