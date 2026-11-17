import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MEDITATION_CACHE, createMeditationCache } from '../cache/meditation-cache.js';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Settings } from './settings.entity.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Settings]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
  controllers: [SettingsController],
  providers: [
    // Selection happens once at module init: no `REDIS_URL` keeps the direct-DB path,
    // a URL adds the service's single read-through adapter. Controllers are unaware.
    // `KeysModule` is here because the settings row itself is an `enc.v1.` envelope.
    {
      provide: MEDITATION_CACHE,
      useFactory: () => createMeditationCache(process.env.REDIS_URL),
    },
    SettingsService,
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
