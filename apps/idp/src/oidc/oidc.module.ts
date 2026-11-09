import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../crypto/crypto.module.js';
import { OidcAdapterService } from './adapter/oidc-adapter.service.js';
import { OidcPayload } from './adapter/oidc-payload.entity.js';
import { OidcService } from './oidc.service.js';

@Module({
  imports: [CryptoModule, TypeOrmModule.forFeature([OidcPayload])],
  providers: [OidcService, OidcAdapterService],
  exports: [OidcService, OidcAdapterService],
})
export class OidcModule {}
