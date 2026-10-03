import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from './feedback/feedback.entity';
import { FeedbackEvent } from './feedback/feedback-event.entity';
import { FeedbackCursor } from './feedback/feedback-cursor.entity';
import { FeedbackModule } from './feedback/feedback.module';
import { HealthModule } from './health/health.module';
import { KeysModule } from './keys/keys.module';
import { UserKeys } from './keys/user-keys.entity';

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
    KeysModule,
    HealthModule,
    FeedbackModule,
  ],
})
export class AppModule {}