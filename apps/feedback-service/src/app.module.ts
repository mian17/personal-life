import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from './feedback/feedback.entity.js';
import { FeedbackEvent } from './feedback/feedback-event.entity.js';
import { FeedbackCursor } from './feedback/feedback-cursor.entity.js';
import { EventModule } from './event/event.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { AuditEntry, AuditModule, HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config.js';

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
      entities: [UserKeys, Feedback, FeedbackEvent, FeedbackCursor, AuditEntry],
      synchronize: true,
    }),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    FeedbackModule,
    EventModule,
    AuditModule.forRoot(),
  ],
})
export class AppModule {}
