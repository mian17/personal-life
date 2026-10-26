import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from './feedback/feedback.entity';
import { FeedbackEvent } from './feedback/feedback-event.entity';
import { FeedbackCursor } from './feedback/feedback-cursor.entity';
import { EventModule } from './event/event.module';
import { FeedbackModule } from './feedback/feedback.module';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';

/** Fail closed: no Postgres URL, no boot (`SPEC-feedback-service` Security). */
const dbUrl = process.env.FEEDBACK_DB_URL?.trim();
if (!dbUrl) {
  throw new Error('FEEDBACK_DB_URL is not set');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: dbUrl,
      entities: [UserKeys, Feedback, FeedbackEvent, FeedbackCursor],
      synchronize: true,
    }),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    FeedbackModule,
    EventModule,
  ],
})
export class AppModule {}