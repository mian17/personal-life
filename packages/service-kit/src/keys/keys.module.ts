import { Module, type DynamicModule } from '@nestjs/common';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysService, MASTER_KEY, type KeysOptions } from './keys.service.js';
import { UserKeys } from './user-keys.entity.js';

export { MASTER_KEY, KeysService, type KeysOptions } from './keys.service.js';

/**
 * Load a service's master key exactly once at bootstrap. `loadMasterKeyFromEnv`
 * fails closed on a missing/non-base64/wrong-length value with a message that
 * names the env var but never the key material.
 */
export function createMasterKey(masterKeyEnv: string): Buffer {
  return loadMasterKeyFromEnv(masterKeyEnv);
}

/**
 * The service-kernel DEK custody layer, wired from one implementation.
 *
 * A service imports `KeysModule.forRoot({ masterKeyEnv: 'MEAL_MASTER_KEY' })` and
 * injects `KeysService`; the module loads that env var fail-closed at bootstrap
 * (see {@link createMasterKey}) and registers the shared `user_keys` entity.
 */
@Module({})
export class KeysModule {
  static forRoot(options: KeysOptions): DynamicModule {
    return {
      module: KeysModule,
      imports: [TypeOrmModule.forFeature([UserKeys])],
      providers: [
        { provide: MASTER_KEY, useFactory: () => loadMasterKeyFromEnv(options.masterKeyEnv) },
        KeysService,
      ],
      exports: [KeysService],
    };
  }
}
