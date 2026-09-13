import { createApp } from './app.factory';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file; rely on the ambient environment
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1');
}
bootstrap();
