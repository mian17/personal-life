import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { KeysService, MASTER_KEY, MASTER_KEY_ENV } from './keys.service';
import { UserKeys } from './user-keys.entity';

/**
 * Load the master key exactly once at bootstrap (`D3`). `loadMasterKeyFromEnv`
 * fails closed on a missing/non-base64/wrong-length value with a message that
 * names the env var but never the key material.
 */
export function createMasterKey(): Buffer {
  return loadMasterKeyFromEnv(MASTER_KEY_ENV);
}

@Module({
  imports: [TypeOrmModule.forFeature([UserKeys])],
  providers: [
    { provide: MASTER_KEY, useFactory: createMasterKey },
    KeysService,
  ],
  exports: [KeysService],
})
export class KeysModule {}
