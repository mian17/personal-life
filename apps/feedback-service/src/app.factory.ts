import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthGuard } from './auth/auth.guard';
import { resolveVerifierConfig } from './auth/jwt-verifier';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-feedback-service` Security): verifier config is required up front, so
 * a half-configured service never starts serving. `FEEDBACK_DB_URL` is enforced
 * by `AppModule` and `FEEDBACK_MASTER_KEY` by `KeysModule`'s key factory.
 */
export async function createApp(): Promise<INestApplication> {
  resolveVerifierConfig();
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
