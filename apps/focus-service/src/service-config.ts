import type { VerifierEnvNames } from '@life/service-kit';

/** Env var names this service feeds into the shared JWT verifier. */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'FOCUS_IDP_JWKS_URL',
  audienceEnv: 'FOCUS_SERVICE_AUDIENCE',
};

/** Env var holding the base64 32-byte master key (fail-closed bootstrap). */
export const MASTER_KEY_ENV = 'FOCUS_MASTER_KEY';
