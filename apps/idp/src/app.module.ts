import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { HealthController } from './health/health.controller';
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
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db'),
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
