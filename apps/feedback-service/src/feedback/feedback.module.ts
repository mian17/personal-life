import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Feedback } from './feedback.entity.js';
import { FeedbackController } from './feedback.controller.js';
import { FEEDBACK_CACHE, createFeedbackCache } from './feedback-cache.js';
import { FeedbackService } from './feedback.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Feedback]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
  controllers: [FeedbackController],
  providers: [
    // Selection happens once at module init: REDIS_URL unset keeps the
    // direct-DB path (dev/e2e); set wires the read-through cache. The service is
    // unaware. `feedback_event`/`feedback_cursor` are reached through the write
    // transaction and the T9 dispatcher, so they need no repository here.
    {
      provide: FEEDBACK_CACHE,
      useFactory: () => createFeedbackCache(process.env.REDIS_URL),
    },
    FeedbackService,
  ],
})
export class FeedbackModule {}
