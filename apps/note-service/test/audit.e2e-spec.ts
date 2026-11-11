import { INestApplication } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  AUDIT_EMITTER,
  AUDIT_EVENT_NAME,
  AuditEntry,
  NOOP_AUDIT_LISTENER,
  createAuditListener,
  type AuditListener,
} from '@life/service-kit';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * The reference audit integration suite (SPEC-audit-log §8.2, §8.4, §8.5, §8.6,
 * §8.7, §8.8, §8.9). Every service's `audit.e2e-spec.ts` copies this shape.
 *
 * It runs the real app — real `AuthGuard`, real `NotesController`, throwaway
 * `DB_PATH` — so the rows it reads are rows note-service actually wrote into its
 * own database. Only the emitter's one subscriber is swapped, which is how a
 * single booted app answers every question: does the wired listener write the
 * right row, does the no-op fallback change nothing, and does a refusing
 * repository leave the response untouched (SPEC §8.5, §8.6).
 *
 * The write is fire-and-forget, so a row appears shortly *after* the response the
 * test awaited. Every row assertion polls instead of guessing a delay.
 */

const TEST_DB = join(import.meta.dirname, 'test-audit.db');
const BASE_NODE_ENV = 'test';

/** A well-formed note id no user owns: an allowed request that answers 404. */
const MISSING_NOTE_ID = '7d2c8f4e-1111-4111-8111-1111111111aa';

/** The intent's 14 fields, spelled out: a row carrying a 15th key fails here. */
const AUDIT_FIELDS = [
  'id',
  'occurredAt',
  'actorSub',
  'callerService',
  'via',
  'credentialKind',
  'method',
  'route',
  'status',
  'decision',
  'sourceIp',
  'userAgent',
  'durationMs',
  'requestId',
];

const SUBMITTED_SECRETS = [
  'secret-bearer-token',
  'cookie-value-42',
  'abc123',
  'body-substring-marker',
];

const POLL_ATTEMPTS = 50;
const POLL_INTERVAL_MS = 20;
/** How far a stored arrival time may miss the wall clock of the test process. */
const CLOCK_SLACK_MS = 1_000;

/** The window the reviewer hat queries: the last minute of a test run (§8.9). */
const REVIEW_WINDOW_MS = 60_000;

describe('Audit log wiring (e2e)', () => {
  let app: INestApplication;
  let emitter: EventEmitter;
  let wiredListener: AuditListener;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();

    emitter = app.get<EventEmitter>(AUDIT_EMITTER);
    wiredListener = soleListener(emitter);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    subscribe(emitter, wiredListener);
    await app.get(DataSource).getRepository(AuditEntry).clear();
  });

  describe('one request, one row', () => {
    it('records an allowed request once, in note-service’s own database', async () => {
      const response = await signedGet(app, harness, `/api/notes/${MISSING_NOTE_ID}`);

      const [row] = await waitForRows(app, 1);
      await settlePendingWrites();

      expect(response.status).toBe(404);
      expect(await auditRows(app)).toHaveLength(1);
      expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
      expect(row).toMatchObject({ method: 'GET', route: '/api/notes/:id', status: 404 });
    });

    it('records a request the auth guard rejected once, as a denial', async () => {
      const response = await anonymousGet(app, '/api/notes');

      const [row] = await waitForRows(app, 1);
      await settlePendingWrites();

      expect(response.status).toBe(401);
      expect(await auditRows(app)).toHaveLength(1);
      expect(row).toMatchObject({
        method: 'GET',
        route: '/api/notes',
        status: 401,
        decision: 'denied',
        actorSub: null,
        credentialKind: 'none',
        via: 'anonymous',
      });
    });

    it('derives the decision from the status alone', async () => {
      await signedGet(app, harness, `/api/notes/${MISSING_NOTE_ID}`);
      await signedGet(app, harness, '/api/notes');

      const rows = await waitForRows(app, 2);
      const decisionByStatus = rows.map((row) => [row.status, row.decision]).sort();

      expect(decisionByStatus).toEqual([
        [200, 'allowed'],
        [404, 'error'],
      ]);
    });

    it('stores the route template, never the concrete path', async () => {
      await signedGet(app, harness, `/api/notes/${MISSING_NOTE_ID}`);

      const [row] = await waitForRows(app, 1);

      expect(row.route).toBe('/api/notes/:id');
      expect(JSON.stringify(row)).not.toContain(MISSING_NOTE_ID);
    });

    it('stores the (unmatched) sentinel for a path no route matched', async () => {
      await signedGet(app, harness, '/api/nowhere/at-all');

      const [row] = await waitForRows(app, 1);

      expect(row).toMatchObject({ route: '(unmatched)', status: 404, decision: 'error' });
      expect(JSON.stringify(row)).not.toContain('/api/nowhere/at-all');
    });

    it('records the arrival time, inside the window the request occupied', async () => {
      const arrivalFloor = Date.now() - CLOCK_SLACK_MS;
      await signedGet(app, harness, '/api/notes');
      const arrivalCeiling = Date.now() + CLOCK_SLACK_MS;

      const [row] = await waitForRows(app, 1);

      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(arrivalFloor);
      expect(row.occurredAt.getTime()).toBeLessThanOrEqual(arrivalCeiling);
    });
  });

  describe('credential hygiene', () => {
    it('stores nothing of the credentials, query string, or body it received', async () => {
      const [bearerToken, cookieValue, apiKey, bodySubstring] = SUBMITTED_SECRETS;
      await request(app.getHttpServer())
        .post(`/api/notes?USDA_API_KEY=${apiKey}`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('Cookie', `app_session=${cookieValue}`)
        .set('User-Agent', 'audit-probe/1.0')
        .send({ body: bodySubstring });

      const [row] = await waitForRows(app, 1);
      const stored = JSON.stringify(row);

      expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
      for (const secret of SUBMITTED_SECRETS) expect(stored).not.toContain(secret);
      expect(row).toMatchObject({
        via: 'oidc-cookie',
        credentialKind: 'cookie',
        userAgent: 'audit-probe/1.0',
      });
    });
  });

  describe('reviewer time-range read', () => {
    it('answers a time-range query with nothing older than the oldest request', async () => {
      await signedGet(app, harness, '/api/notes');
      await anonymousGet(app, '/api/notes');
      await waitForRows(app, 2);

      const rows = await rowsSince(app, new Date(Date.now() - REVIEW_WINDOW_MS));
      const arrivalTimes = rows.map((row) => row.occurredAt.getTime());

      expect(rows).toHaveLength(2);
      expect(arrivalTimes).toEqual([...arrivalTimes].sort((earlier, later) => earlier - later));
    });
  });

  describe('no listener registered', () => {
    it('serves requests unchanged and writes no row', async () => {
      subscribe(emitter, NOOP_AUDIT_LISTENER);

      const allowed = await signedGet(app, harness, '/api/notes');
      const denied = await anonymousGet(app, '/api/notes');

      expect(allowed.body).toHaveProperty('notes');
      expect(denied.status).toBe(401);
      expect(await auditRows(app)).toHaveLength(0);
    });
  });

  describe('audit write failing', () => {
    let unhandledRejections: unknown[];
    const recordUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    beforeEach(() => {
      unhandledRejections = [];
      process.on('unhandledRejection', recordUnhandledRejection);
      subscribe(emitter, createAuditListener(refusingWriter()));
    });

    afterEach(() => {
      process.off('unhandledRejection', recordUnhandledRejection);
    });

    it('answers normally and leaves no unhandled rejection', async () => {
      const allowed = await signedGet(app, harness, '/api/notes');
      const denied = await anonymousGet(app, '/api/notes');

      expect(allowed.body).toHaveProperty('notes');
      expect(denied.body).toHaveProperty('statusCode', 401);
      await settlePendingWrites();
      expect(unhandledRejections).toEqual([]);
      expect(await auditRows(app)).toHaveLength(0);
    });
  });
});

/** One request through the real guard, carrying a token the local JWKS signed. */
async function signedGet(
  app: INestApplication,
  harness: JwtTestHarness,
  path: string,
): Promise<request.Response> {
  const token = await harness.sign();
  return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
}

/** One request with no credential: the guard rejects it before any controller runs. */
function anonymousGet(app: INestApplication, path: string): Promise<request.Response> {
  return request(app.getHttpServer()).get(path);
}

/** Poll until `count` rows exist: the listener writes after the response ends. */
async function waitForRows(app: INestApplication, count: number): Promise<AuditEntry[]> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const rows = await auditRows(app);
    if (rows.length >= count) return rows;
    await settlePendingWrites();
  }
  throw new Error(`expected ${count} audit rows, found fewer after polling`);
}

/** Every stored row, oldest arrival first — the shape the reviewer hat reads. */
function auditRows(app: INestApplication): Promise<AuditEntry[]> {
  return app
    .get(DataSource)
    .getRepository(AuditEntry)
    .find({ order: { occurredAt: 'ASC' } });
}

/** The reviewer's own query: a time range, oldest first (SPEC §8.9). */
function rowsSince(app: INestApplication, from: Date): Promise<AuditEntry[]> {
  return app
    .get(DataSource)
    .getRepository(AuditEntry)
    .createQueryBuilder('row')
    .where('row.occurredAt >= :from', { from })
    .orderBy('row.occurredAt', 'ASC')
    .getMany();
}

/** The writing listener the module registered, captured before any test swaps it. */
function soleListener(emitter: EventEmitter): AuditListener {
  const [listener] = emitter.listeners(AUDIT_EVENT_NAME);
  return listener as AuditListener;
}

/** Replace whatever the emitter calls: the audit path has exactly one subscriber. */
function subscribe(emitter: EventEmitter, listener: AuditListener): void {
  emitter.removeAllListeners(AUDIT_EVENT_NAME);
  emitter.on(AUDIT_EVENT_NAME, listener);
}

/** A writer that refuses every save, standing in for an unreachable database. */
function refusingWriter() {
  return {
    save: async () => {
      throw new Error('audit_log is unreachable');
    },
  };
}

/** Let the fire-and-forget write (or its rejection) finish. */
function settlePendingWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
