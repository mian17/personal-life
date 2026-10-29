import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthGuard, resolveVerifierConfig } from '@life/service-kit';
import { AppModule } from './app.module';
import { VERIFIER_ENV } from './service-config';

/**
 * Build the application with the global kernel wiring. Boot fails closed
 * (`SPEC-focus-service` §2): verifier config resolves up front, `FOCUS_DB_URL` is
 * enforced by `AppModule`, and `FOCUS_MASTER_KEY` by `KeysModule`'s key factory.
 */
export async function createApp(): Promise<INestApplication> {
  resolveVerifierConfig(VERIFIER_ENV);
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  return app;
}
