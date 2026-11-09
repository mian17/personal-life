import { createApp } from './app.factory.js';

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3008), process.env.HOST ?? '127.0.0.1');
}
void bootstrap();
