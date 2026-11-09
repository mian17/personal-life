import { Module } from '@nestjs/common';
import { SigningKeyService } from './signing-key.service.js';

@Module({
  providers: [SigningKeyService],
  exports: [SigningKeyService],
})
export class CryptoModule {}
