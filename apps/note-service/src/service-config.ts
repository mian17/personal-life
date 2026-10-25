import type { VerifierEnvNames } from '@life/service-kit';

/** The env var names this service feeds into the shared JWT verifier. */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'IDP_JWKS_URL',
  audienceEnv: 'NOTE_SERVICE_AUDIENCE',
};

/** Env var holding the base64 32-byte master key (`D3`). */
export const MASTER_KEY_ENV = 'NOTE_MASTER_KEY';
