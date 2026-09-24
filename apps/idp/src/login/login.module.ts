import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { LoginController } from './login.controller';
import { InteractionController } from './interaction.controller';
import { OidcModule } from '../oidc/oidc.module';

@Module({
  imports: [UsersModule, SessionsModule, OidcModule],
  controllers: [LoginController, InteractionController],
})
export class LoginModule {}
