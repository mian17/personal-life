import { createApp } from './app.factory.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3109), process.env.HOST ?? '127.0.0.1');
}

await bootstrap();
