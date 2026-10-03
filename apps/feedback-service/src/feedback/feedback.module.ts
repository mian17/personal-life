import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '../keys/keys.module';
import { Feedback } from './feedback.entity';
import { FeedbackController } from './feedback.controller';
import { FEEDBACK_CACHE, createFeedbackCache } from './feedback-cache';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [TypeOrmModule.forFeature([Feedback]), KeysModule],
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