import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { LoginController } from './login.controller';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [LoginController],
})
export class LoginModule {}
