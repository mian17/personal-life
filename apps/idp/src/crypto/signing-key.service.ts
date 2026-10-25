import { Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { resolveDbPath } from '../config/db-path';
import { JsonWebKeySet, loadOrCreateKeySet } from './signing-keys';

/**
 * `KEYS_PATH` overrides the key file location; the default sits next to the
 * service database under `data/` (gitignored) so it follows `DB_PATH` in tests
 * and the scratch/production split outside them.
 */
export function resolveKeysPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KEYS_PATH) return env.KEYS_PATH;
  return join(dirname(resolveDbPath(env)), 'keys.json');
}

/**
 * Holds the process-wide signing key set, loaded from disk on first use. A
 * process that never serves the OIDC surface therefore never creates key
 * material — the seed script and the non-OIDC routes stay key-free.
 * Key material is only ever read here and handed to the provider/JWT helpers;
 * it is never logged.
 */
@Injectable()
export class SigningKeyService {
  private set?: JsonWebKeySet;

  jwks(): JsonWebKeySet {
    this.set ??= loadOrCreateKeySet(resolveKeysPath());
    return this.set;
  }
}
