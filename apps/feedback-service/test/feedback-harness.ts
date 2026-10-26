import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createServer, type Server } from 'http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { bin, childEnv } from '../../../packages/shared/src/child-process';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import type { CacheClient, CacheSetOptions } from '@life/cache';
import { AuthGuard } from '@life/service-kit';
import { VERIFIER_ENV } from '../src/service-config';
import { FEEDBACK_CACHE, FeedbackCache } from '../src/feedback/feedback-cache';
import {
  EVENT_SINK,
  type EventSink,
  type FeedbackSubmittedBody,
} from '../src/event/publisher.service';
import { FEEDBACK_NOTIFY_CHANNEL } from '../src/event/trigger-ddl';

/**
 * Integration harness for `SPEC-feedback-service`'s seven behavior groups.
 *
 * Postgres is the one dependency that cannot be faked: `pg-mem` has no faithful
 * NOTIFY/LISTEN, and groups 2/3/7 are entirely about the change log. So every
 * suite runs against a **throwaway** database — a per-run `feedback_t<random>`
 * schema created either on the operator's `FEEDBACK_TEST_DB_URL` server or on a
 * short-lived `postgres:17-alpine` container published on an ephemeral loopback
 * port. Never a data directory, never the compose `postgres-feedback`.
 *
 * A host with neither gets the suites **skipped, never failed**.
 *
 * The cache and AMQP seams are injected: `EVENT_SINK` gets a fake sink that
 * records confirms, `FEEDBACK_CACHE` a fake Redis client, so assertions are
 * about this service's logic rather than about a broker.
 */

const IMAGE = 'postgres:17-alpine';
const CONTAINER_PASSWORD = 'test-only';

export const TEST_ISSUER = 'https://idp.test';
/** The shared ecosystem audience the kernel token model verifies. */
export const TEST_AUDIENCE = 'life-api';
/** Obviously-fake key: a public test artifact, never a real secret. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 0x2a).toString('base64');

export function sleep(ms: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}

/** Poll `condition` until it holds; fails (never hangs) on timeout. */
export async function waitFor(
  condition: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Poll an async `condition` (a DB read) until it holds. */
export async function waitForAsync(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function run(args: string[], capture = false): string {
  return execFileSync(bin('docker'), args, {
    env: childEnv(),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  });
}

/**
 * True when a throwaway Postgres can be provided — either the operator pointed
 * `FEEDBACK_TEST_DB_URL` at a server, or Docker can start one. Suites gate on
 * this so an absent Docker skips instead of failing.
 */
export function canProvidePostgres(): boolean {
  if (process.env.FEEDBACK_TEST_DB_URL?.trim()) return true;
  try {
    run(['version']);
    return true;
  } catch {
    return false;
  }
}

export interface ThrowawayPostgres {
  url: string;
  stop(): Promise<void>;
}

/** Create a fresh `feedback_<label>` database and return its URL. */
async function createDatabase(serverUrl: string, label: string): Promise<string> {
  const name = `feedback_${label}`;
  const admin = new DataSource({ type: 'postgres', url: serverUrl, entities: [] });
  await admin.initialize();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.destroy();
  }
  const parsed = new URL(serverUrl);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

async function startContainer(): Promise<{ url: string; stop(): Promise<void> }> {
  const name = `feedback-test-${process.pid}-${randomUUID().slice(0, 8)}`;
  let port: string | null = null;
  const stop = async (): Promise<void> => {
    try {
      run(['rm', '-f', name]);
    } catch {
      /* already gone */
    }
  };
  try {
    run([
      'run',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      `POSTGRES_PASSWORD=${CONTAINER_PASSWORD}`,
      '-e',
      'POSTGRES_DB=postgres',
      // Ephemeral loopback port: reachable from this host only.
      '-p',
      '127.0.0.1::5432',
      IMAGE,
    ]);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !port) {
      const mapped = run(['port', name, '5432/tcp'], true).trim();
      const match = /:(\d+)$/.exec(mapped.split('\n')[0] ?? '');
      if (match) port = match[1];
      else await sleep(250);
    }
    if (!port) throw new Error('postgres container never published a port');

    // `pg_isready` also answers during the image entrypoint's temporary
    // bootstrap server, which is shut down and replaced a moment later; a
    // connection opened against it dies with "Connection terminated
    // unexpectedly". Query the real database instead, so the pool only ever
    // talks to the postmaster that survives.
    for (let attempt = 0; ; attempt += 1) {
      try {
        run(['exec', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], true);
        break;
      } catch {
        if (attempt >= 60) throw new Error('postgres never became ready');
        await sleep(500);
      }
    }
    return { url: `postgresql://postgres:${CONTAINER_PASSWORD}@127.0.0.1:${port}/postgres`, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

/**
 * A throwaway Postgres for one test file. Unique database per run, so
 * concurrent Jest workers and the production compose `postgres` are never
 * touched and never share a change log.
 */
export async function startThrowawayPostgres(label: string): Promise<ThrowawayPostgres> {
  const configured = process.env.FEEDBACK_TEST_DB_URL?.trim();
  const server = configured
    ? { url: configured, stop: async (): Promise<void> => undefined }
    : await startContainer();
  const url = await createDatabase(server.url, label);
  return { url, stop: server.stop };
}

/**
 * Hermetic JWT harness: a loopback JWKS server over an ephemeral Ed25519 key
 * generated at runtime (never committed), so the real global `AuthGuard`
 * verifies real tokens instead of the suite reaching around it.
 */
export class JwtHarness {
  private server?: Server;
  private privateKey?: CryptoKey;
  private jwk?: Record<string, unknown>;

  async start(): Promise<this> {
    const pair = await generateKeyPair('Ed25519', { extractable: true });
    this.privateKey = pair.privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'EdDSA', use: 'sig' };
    this.server = createServer((req, res) => {
      if (req.url === '/jwks') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [this.jwk] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((settle) => this.server!.listen(0, '127.0.0.1', settle));
    return this;
  }

  get jwksUrl(): string {
    const address = this.server!.address() as { port: number };
    return `http://127.0.0.1:${address.port}/jwks`;
  }

  /** Mints an access token for `subject` under the harness issuer/audience. */
  async sign(subject: string, expiresInS = 3600): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: subject })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresInS)
      .sign(this.privateKey!);
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((settle) => this.server!.close(() => settle()));
  }
}

/**
 * The consumer's side of the at-least-once guarantee: it dedups on `event_id`,
 * so a replayed message is recorded as a duplicate while the effect applies
 * exactly once (`SPEC-feedback-service` "Delivery guarantees").
 */
export class FakeConsumer {
  readonly applied: FeedbackSubmittedBody[] = [];
  readonly duplicates: string[] = [];

  receive(body: FeedbackSubmittedBody): void {
    if (this.applied.some((seen) => seen.event_id === body.event_id)) {
      this.duplicates.push(body.event_id);
      return;
    }
    this.applied.push(body);
  }
}

/**
 * Fake AMQP sink (Testing strategy 3). Records the exact bodies the dispatcher
 * handed the publisher; `fail = true` makes every confirm reject, which is how
 * the "cursor never advances without a broker confirm" cases are driven.
 */
export class FakeEventSink implements EventSink {
  readonly published: FeedbackSubmittedBody[] = [];
  fail = false;

  /** Share a consumer across a restart to observe redelivery dedup. */
  constructor(readonly consumer: FakeConsumer = new FakeConsumer()) {}

  async publish(body: FeedbackSubmittedBody): Promise<void> {
    if (this.fail) throw new Error('broker unavailable');
    this.published.push(body);
    this.consumer.receive(body);
  }

  get eventIds(): string[] {
    return this.published.map((body) => body.event_id);
  }
}

/**
 * Fake node-redis client implementing the `@life/cache` `CacheClient` surface
 * and recording every raw value written, so the suite can assert on exactly
 * what Redis would have persisted.
 */
export class FakeRedisClient implements CacheClient {
  readonly store = new Map<string, string>();
  readonly written: Array<{ key: string; value: string }> = [];
  readonly incrCalls: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, options?: CacheSetOptions): Promise<'OK'> {
    this.written.push({ key, value });
    if (options?.EX === undefined) throw new Error('every cache write must carry a TTL');
    this.store.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.incrCalls.push(key);
    const next = (Number.parseInt(this.store.get(key) ?? '0', 10) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }

  get setCalls(): string[] {
    return this.written.map((entry) => entry.key);
  }
}

/** Every command rejects — Redis unreachable, i.e. the fail-open case. */
export class FailingRedisClient implements CacheClient {
  async get(): Promise<string | null> {
    throw new Error('redis unreachable');
  }

  async set(): Promise<'OK'> {
    throw new Error('redis unreachable');
  }

  async incr(): Promise<number> {
    throw new Error('redis unreachable');
  }
}

export interface FeedbackApp {
  app: INestApplication;
  dataSource: DataSource;
  sink: FakeEventSink;
  close(): Promise<void>;
}

export interface StartAppOptions {
  /** Postgres URL of a throwaway database. */
  dbUrl: string;
  jwt: JwtHarness;
  /** Omit for a fresh fake sink. */
  sink?: FakeEventSink;
  /**
   * Cache selection: `'direct'` (default) leaves `REDIS_URL` unset so the
   * module's own factory takes the direct-DB path; `'failing'` injects a
   * client whose every command rejects; a `FakeRedisClient` injects a
   * recording client.
   */
  cache?: 'direct' | 'failing' | FakeRedisClient;
  /** Reconciliation-tick period; a short value drives the dropped-NOTIFY case. */
  reconcileMs?: number;
}

/**
 * Boot the real application graph — the same `AppModule`, global `AuthGuard`
 * and global `ValidationPipe` `main.ts` uses — against a throwaway database,
 * faking only the cache and broker seams.
 *
 * `AppModule` reads `FEEDBACK_DB_URL` at import time, so the env is applied
 * before the dynamic import; one file runs every app against that file's own
 * throwaway database. Booting a second app after closing the first is a real
 * restart (fresh DataSource, fresh dispatcher) on the same durable state —
 * exactly what the dispatcher restart group needs.
 */
export async function startFeedbackApp(options: StartAppOptions): Promise<FeedbackApp> {
  const sink = options.sink ?? new FakeEventSink();

  process.env.FEEDBACK_DB_URL = options.dbUrl;
  process.env.IDP_ISSUER = TEST_ISSUER;
  process.env.FEEDBACK_IDP_JWKS_URL = options.jwt.jwksUrl;
  process.env.FEEDBACK_SERVICE_AUDIENCE = TEST_AUDIENCE;
  process.env.FEEDBACK_MASTER_KEY = TEST_MASTER_KEY;
  // Pinned away from `development` so the guard's dev bypass cannot mask a
  // missing token, and no AMQP URL: the broker is faked.
  process.env.NODE_ENV = 'test';
  delete process.env.REDIS_URL;
  delete process.env.RABBITMQ_URL;
  if (options.reconcileMs === undefined) delete process.env.FEEDBACK_RECONCILE_MS;
  else process.env.FEEDBACK_RECONCILE_MS = String(options.reconcileMs);

  const cache: FeedbackCache | null =
    options.cache === undefined || options.cache === 'direct'
      ? null
      : new FeedbackCache(options.cache === 'failing' ? new FailingRedisClient() : options.cache);

  const { AppModule } = await import('../src/app.module');
  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  }).overrideProvider(EVENT_SINK).useValue(sink);
  if (cache) builder = builder.overrideProvider(FEEDBACK_CACHE).useValue(cache);

  const app = (await builder.compile()).createNestApplication();
  app.useGlobalGuards(new AuthGuard(VERIFIER_ENV));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();

  return {
    app,
    dataSource: app.get(DataSource),
    sink,
    close: async () => {
      await app.close();
    },
  };
}

/** The raw notification payload the trigger sends (`seq` + `event_id`). */
export interface NotifyPayload {
  /** `json_build_object('seq', NEW.seq, …)` emits seq as a JSON number. */
  seq: number;
  event_id: string;
}

/**
 * A real `LISTEN feedback_events` connection, independent of the dispatcher's
 * own: this is how group 2 proves the trigger fires on commit and stays silent
 * on a rolled-back write.
 */
export interface NotificationProbe {
  received: NotifyPayload[];
  close(): Promise<void>;
}

export async function listenForFeedbackEvents(dataSource: DataSource): Promise<NotificationProbe> {
  const pool = (
    dataSource.driver as unknown as {
      master: {
        connect(): Promise<{
          query(text: string): Promise<unknown>;
          on(event: string, listener: (arg: unknown) => void): unknown;
          release(err?: boolean | Error): void;
        }>;
      };
    }
  ).master;
  const client = await pool.connect();
  const received: NotifyPayload[] = [];
  client.on('notification', (msg: unknown) => {
    const { channel, payload } = msg as { channel: string; payload?: string };
    if (channel !== FEEDBACK_NOTIFY_CHANNEL || !payload) return;
    received.push(JSON.parse(payload) as NotifyPayload);
  });
  client.on('error', () => undefined);
  await client.query(`LISTEN ${FEEDBACK_NOTIFY_CHANNEL}`);
  return {
    received,
    close: async () => {
      await client.query(`UNLISTEN ${FEEDBACK_NOTIFY_CHANNEL}`).catch(() => undefined);
      client.release();
    },
  };
}

/** A UUID v4 — the client-supplied idempotency key shape. */
export function feedbackId(): string {
  return randomUUID();
}

/** A minimal valid `POST /api/feedback` body. */
export function feedbackBody(
  id: string,
  description: string,
  title = 'A feedback title',
): Record<string, unknown> {
  return { id, app: 'notes', type: 'bug_report', title, description };
}

type RequestTest = request.Test;

export function postFeedback(
  target: FeedbackApp,
  token: string,
  body: Record<string, unknown>,
): RequestTest {
  return request(target.app.getHttpServer())
    .post('/api/feedback')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

export function getFeedback(target: FeedbackApp, token: string): RequestTest {
  return request(target.app.getHttpServer())
    .get('/api/feedback')
    .set('Authorization', `Bearer ${token}`);
}

export function patchFeedbackStatus(
  target: FeedbackApp,
  token: string,
  id: string,
  body: Record<string, unknown>,
): RequestTest {
  return request(target.app.getHttpServer())
    .patch(`/api/feedback/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** A raw pooled connection, for statements no repository express (BEGIN/ROLLBACK). */
export interface RawQueryClient {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(err?: boolean | Error): void;
}

export async function rawClient(dataSource: DataSource): Promise<RawQueryClient> {
  const pool = (dataSource.driver as unknown as { master: { connect(): Promise<RawQueryClient> } })
    .master;
  return pool.connect();
}