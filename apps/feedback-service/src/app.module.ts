import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
      // T8/T9 add the feedback, event, and cursor entities here.
      entities: [UserKeys],
      synchronize: true,
    }),
    KeysModule,
    HealthModule,
  ],
})
export class AppModule {}
