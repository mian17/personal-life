import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { OidcService } from './oidc.service';

@Module({
  imports: [CryptoModule],
  providers: [OidcService],
  exports: [OidcService],
})
export class OidcModule {}
