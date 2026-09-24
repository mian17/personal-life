import { Injectable } from '@nestjs/common';
import { dirname, join } from 'path';
import { JsonWebKeySet, loadOrCreateKeySet } from './signing-keys';

/**
 * `KEYS_PATH` overrides the key file location; the default sits next to the
 * service database under `data/` (gitignored) so it follows `DB_PATH` in tests.
 */
export function resolveKeysPath(): string {
  if (process.env.KEYS_PATH) return process.env.KEYS_PATH;
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db');
  return join(dirname(dbPath), 'keys.json');
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
