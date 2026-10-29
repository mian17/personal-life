import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';
import { Goal } from './goals/goal.entity';
import { GoalsModule } from './goals/goals.module';
import { Session } from './sessions/session.entity';
import { SessionsModule } from './sessions/sessions.module';

/** Fail closed: no Postgres URL, no boot (`SPEC-focus-service` §2). */
const dbUrl = process.env.FOCUS_DB_URL?.trim();
if (!dbUrl) {
  throw new Error('FOCUS_DB_URL is not set');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: dbUrl,
      entities: [UserKeys, Session, Goal],
      synchronize: true,
    }),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    SessionsModule,
    GoalsModule,
  ],
})
export class AppModule {}
