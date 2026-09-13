import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  mkdirSync(dirname(process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db')), {
    recursive: true,
  });
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1');
}
bootstrap();
