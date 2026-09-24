import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../crypto/crypto.module';
import { OidcAdapterService } from './adapter/oidc-adapter.service';
import { OidcPayload } from './adapter/oidc-payload.entity';
import { OidcService } from './oidc.service';

@Module({
  imports: [CryptoModule, TypeOrmModule.forFeature([OidcPayload])],
  providers: [OidcService, OidcAdapterService],
  exports: [OidcService, OidcAdapterService],
})
export class OidcModule {}
