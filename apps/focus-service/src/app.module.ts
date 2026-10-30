import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';
import { Goal } from './goals/goal.entity';
import { GoalsModule } from './goals/goals.module';
import { Session } from './sessions/session.entity';
import { SessionsModule } from './sessions/sessions.module';

/**
 * SQLite through `better-sqlite3`, the `note-service` shape (`SPEC-focus-service`
 * §2 Storage): the session and goal rows are numbers, dates and ids, so nothing
 * here needs a database server. `FOCUS_DB_PATH` is the one override; the default
 * is this workspace's own `data/` directory, and `app.factory` creates it.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.FOCUS_DB_PATH ?? join(process.cwd(), 'data', 'focus.db'),
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
