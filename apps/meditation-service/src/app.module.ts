import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from '@life/service-kit';
import { SessionsModule } from './sessions/sessions.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { MASTER_KEY_ENV, resolveDatabasePath } from './service-config.js';

/**
 * SQLite through `better-sqlite3`, the `focus-service` shape: this service keeps
 * its own rows in its own file, and the default path is this workspace's `data/`
 * directory (`app.factory` creates it). Two domain slices: the owner's settings and the
 * sitting log. `autoLoadEntities` lets each slice declare its own entity through
 * `forFeature` instead of every one of them being listed here.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveDatabasePath(),
      autoLoadEntities: true,
      synchronize: true,
    }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    SettingsModule,
    SessionsModule,
  ],
})
export class AppModule {}
