import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3003), process.env.HOST ?? '127.0.0.1');
}
void bootstrap();
