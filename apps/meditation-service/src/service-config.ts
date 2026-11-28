import type { VerifierEnvNames } from '@life/service-kit';
import { join } from 'node:path';

/** Env var names this service feeds into the shared JWT verifier. */
export const VERIFIER_ENV: VerifierEnvNames = {
  jwksUrlEnv: 'MEDITATION_IDP_JWKS_URL',
  audienceEnv: 'MEDITATION_SERVICE_AUDIENCE',
};

/** Env var holding the base64 32-byte master key (fail-closed bootstrap). */
export const MASTER_KEY_ENV = 'MEDITATION_MASTER_KEY';

/** Env var overriding where the service keeps its own SQLite file. */
export const DATABASE_PATH_ENV = 'MEDITATION_DB_PATH';

/** The service's SQLite file: the env override, or this workspace's `data/`. */
export function resolveDatabasePath(): string {
  return process.env[DATABASE_PATH_ENV] ?? join(process.cwd(), 'data', 'meditation.db');
}
