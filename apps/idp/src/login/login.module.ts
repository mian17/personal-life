import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersModule } from '../users/users.module.js';
import { LoginController } from './login.controller.js';
import { InteractionController } from './interaction.controller.js';
import { OidcModule } from '../oidc/oidc.module.js';

@Module({
  imports: [UsersModule, SessionsModule, OidcModule],
  controllers: [LoginController, InteractionController],
})
export class LoginModule {}
