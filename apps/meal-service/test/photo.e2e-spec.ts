import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../src/auth/auth.guard';
import { MealCache } from '../src/cache/meal-cache';
import { Entry } from '../src/entries/entry.entity';
import { COULD_NOT_READ, GeminiClient } from '../src/photo/gemini.client';
import { zeroVector } from '../src/foods/content';
import { GEMINI_CLIENT_FACTORY } from '../src/photo/photo.service';
import { FakeGemini, geminiResponse, readablePayload } from './fake-gemini';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

/**
 * Photo estimates over HTTP (`SPEC-meal-service` Photo → Gemini pipeline,
 * Task 13 acceptance).
 *
 * The route is driven through the real app with the real guard, but Gemini is
 * the `FakeGemini` transport (`fake-gemini.ts`, no network): the suite proves
 * the endpoint contract — a suggestion or the explicit failure — and the three
 * things the pipeline must never do:
 *
 * - never writes an entry (no save call, no row, and the diary route reads
 *   back empty after an estimate);
 * - image bytes and the key are never persisted or logged (absent from the
 *   response and from every captured console line);
 * - estimate responses are never cached (no `MealCache` call, and the same
 *   photo reaches the model on every request).
 */

const TEST_DB = join(__dirname, 'test-photo.db');
process.env.DB_PATH = TEST_DB;

const BASE_NODE_ENV = 'test';
const IMAGE_BYTES = Buffer.from('photo-bytes-not-a-real-meal-7f3a9c', 'utf8');
const IMAGE_B64 = IMAGE_BYTES.toString('base64');
const MIME = 'image/jpeg';
const HINT = 'leftover from last night, in the blue bowl';
const FAKE_KEY = 'fake-key-DO-NOT-LOG-9d2b';

const geminiEnv = (): NodeJS.ProcessEnv => ({
  GEMINI_API_KEY: FAKE_KEY,
  GEMINI_MODEL: 'test-model-id',
  GEMINI_API_BASE: 'https://gemini.test/v1beta',
});

let token = '';

const post = (app: INestApplication, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/estimates/photo').send(body);
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

async function entryCount(app: INestApplication): Promise<number> {
  return app.get(DataSource).getRepository(Entry).count();
}

describe('Photo estimates (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let harness: JwtTestHarness;
  let fake: FakeGemini;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;
    delete process.env.REDIS_URL;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ subject: 'user-a', expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    fake = new FakeGemini();
    const { AppModule } = await import('../src/app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GEMINI_CLIENT_FACTORY)
      .useValue(() => new GeminiClient(geminiEnv(), fake.handler))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new AuthGuard());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(() => {
    process.env.NODE_ENV = BASE_NODE_ENV;
    fake.reply = () => geminiResponse(readablePayload());
    fake.calls.length = 0;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  it('returns a suggestion for a readable photo, with the hint steering the read', async () => {
    const getThrough = jest.spyOn(MealCache.prototype, 'getThrough');
    const bump = jest.spyOn(MealCache.prototype, 'bumpGeneration');
    const out: string[] = [];
    for (const method of ['log', 'error', 'warn'] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        out.push(args.map(String).join(' '));
      });
    }

    const res = await auth(post(app, { imageBase64: IMAGE_B64, mimeType: MIME, hint: HINT })).expect(
      200,
    );

    expect(res.body.readable).toBe(true);
    expect(res.body.items).toHaveLength(1);

    // Identity is the model's answer; `servingGrams`/`nutrients` are the
    // service's own fields — the model's payload carries no nutrient key at all.
    // With both ids null the suggestion resolves down path 3, so the 100 g base
    // and `zeroVector()` are the real result, not placeholders. The
    // catalog-resolved and USDA-resolved paths live in `photo-resolve.test.ts`.
    expect(res.body.items[0]).toEqual({
      name: 'Chicken salad',
      grams: 250,
      foodId: null,
      fdcId: null,
      servingGrams: 100,
      nutrients: zeroVector(),
    });
    // Estimated-vs-verified is derived by the editor, never carried on the wire.
    expect(res.body.items[0]).not.toHaveProperty('isEstimated');

    // The hint rides to the model as steering input, alongside the image.
    const textParts = fake
      .lastParts()
      .filter((part) => typeof part.text === 'string')
      .map((part) => part.text as string);
    expect(textParts).toHaveLength(2);
    expect(textParts[1]).toContain(HINT);

    // Never an entry, never the cache: the suggestion is transient.
    expect(await entryCount(app)).toBe(0);
    expect(getThrough).not.toHaveBeenCalled();
    expect(bump).not.toHaveBeenCalled();

    // Neither the bytes nor the key leak into the response or any log.
    const bodyJson = JSON.stringify(res.body);
    expect(bodyJson).not.toContain(IMAGE_B64);
    expect(bodyJson).not.toContain(FAKE_KEY);
    expect(out.join('\n')).not.toContain(IMAGE_B64);
    expect(out.join('\n')).not.toContain(FAKE_KEY);
  });

  it('returns the explicit failure shape when the photo cannot be read', async () => {
    fake.reply = () => geminiResponse({ readable: false, items: [] });

    const res = await auth(post(app, { imageBase64: IMAGE_B64, mimeType: MIME })).expect(200);

    expect(res.body).toEqual({ readable: false, reason: COULD_NOT_READ });
    expect(await entryCount(app)).toBe(0);
  });

  it('never caches estimates: the same photo reaches the model every time', async () => {
    const getThrough = jest.spyOn(MealCache.prototype, 'getThrough');
    const body = { imageBase64: IMAGE_B64, mimeType: MIME };

    await auth(post(app, body)).expect(200);
    await auth(post(app, body)).expect(200);

    expect(fake.calls).toHaveLength(2);
    expect(getThrough).not.toHaveBeenCalled();
    expect(await entryCount(app)).toBe(0);
  });

  it('never writes an entry: the diary has no row after an estimate', async () => {
    const save = jest.spyOn(app.get(DataSource).getRepository(Entry), 'save');

    const res = await auth(post(app, { imageBase64: IMAGE_B64, mimeType: MIME })).expect(200);

    expect(res.body.readable).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(await entryCount(app)).toBe(0);

    // Route-level: a confirmed entry would appear here; it does not.
    const listed = await auth(request(app.getHttpServer()).get('/api/entries?date=2026-10-03')).expect(200);
    expect(listed.body).toEqual([]);
  });

  it('takes the owner from the token, never the body', async () => {
    await post(app, { imageBase64: IMAGE_B64, mimeType: MIME }).expect(401);
    await auth(post(app, { imageBase64: IMAGE_B64, mimeType: MIME, ownerSub: 'user-b' })).expect(
      400,
    );
  });
});
