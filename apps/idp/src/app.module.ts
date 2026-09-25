import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { resolveDbPath } from './config/db-path';
import { LoginModule } from './login/login.module';
import { OidcModule } from './oidc/oidc.module';
import { OidcPayload } from './oidc/adapter/oidc-payload.entity';
import { Session } from './sessions/session.entity';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

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
