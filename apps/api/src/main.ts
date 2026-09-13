import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1');
}
bootstrap();
