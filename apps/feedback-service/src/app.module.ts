import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from './feedback/feedback.entity';
import { FeedbackEvent } from './feedback/feedback-event.entity';
import { FeedbackCursor } from './feedback/feedback-cursor.entity';
import { EventModule } from './event/event.module';
import { FeedbackModule } from './feedback/feedback.module';
import { HealthModule } from '@life/service-kit';
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
    HealthModule.forRoot({ masterKeyEnv: 'FEEDBACK_MASTER_KEY' }),
    FeedbackModule,
    EventModule,
  ],
})
export class AppModule {}