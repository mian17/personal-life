import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MEDITATION_CACHE, createMeditationCache } from '../cache/meditation-cache.js';
import { MASTER_KEY_ENV } from '../service-config.js';
import { SettingsModule } from '../settings/settings.module.js';
import { Session } from './session.entity.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    // The day-done read is measured against the owner's current goal, so this slice reads
    // settings through its exported service rather than a second reader of the same row.
    SettingsModule,
  ],
  controllers: [SessionsController],
  providers: [
    // Selection happens once at module init: no `REDIS_URL` keeps the direct-DB path, a
    // URL adds the service's single read-through adapter. Controllers are unaware.
    // `KeysModule` is here because a sitting's numbers are an `enc.v1.` envelope.
    {
      provide: MEDITATION_CACHE,
      useFactory: () => createMeditationCache(process.env.REDIS_URL),
    },
    SessionsService,
  ],
})
export class SessionsModule {}
