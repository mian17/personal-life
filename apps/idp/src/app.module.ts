import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller.js';
import { resolveDbPath } from './config/db-path.js';
import { LoginModule } from './login/login.module.js';
import { OidcModule } from './oidc/oidc.module.js';
import { OidcPayload } from './oidc/adapter/oidc-payload.entity.js';
import { Session } from './sessions/session.entity.js';
import { User } from './users/user.entity.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveDbPath(),
      entities: [User, Session, OidcPayload],
      synchronize: true,
    }),
    UsersModule,
    LoginModule,
    OidcModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
