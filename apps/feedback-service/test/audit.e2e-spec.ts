import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditEntry } from '@life/service-kit';
import {
  JwtHarness,
  canProvidePostgres,
  sleep,
  startFeedbackApp,
  startThrowawayPostgres,
  type FeedbackApp,
  type ThrowawayPostgres,
} from './feedback-harness.js';

/**
 * Wiring proof for the audit capability in feedback-service (SPEC-audit-log
 * §8.2, §8.10). The behavior itself lives in `@life/service-kit` and is proven
 * once by note-service's reference suite; this suite only proves that importing
 * `AuditModule.forRoot()` and registering `AuditEntry` here is enough — on the
 * repo's one Postgres service, so it also proves the entity needs no schema
 * special-casing per driver.
 *
 * One allowed request and one guard rejection, each landing exactly one row in
 * feedback-service's own database.
 *
 * Skipped — never failed — when Docker is absent and no `FEEDBACK_TEST_DB_URL`
 * is configured; no data directory and no compose service is ever touched.
 */

jest.setTimeout(180_000);

const describeDb = canProvidePostgres() ? describe : describe.skip;

const OWNER = 'owner-audit';
const FEEDBACK_PATH = '/api/feedback';

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

const POLL_ATTEMPTS = 50;
const POLL_INTERVAL_MS = 20;

describeDb('Audit log wiring (e2e)', () => {
  let pg: ThrowawayPostgres;
  let jwt: JwtHarness;
  let target: FeedbackApp;

  beforeAll(async () => {
    pg = await startThrowawayPostgres('audit');
    jwt = await new JwtHarness().start();
    target = await startFeedbackApp({ dbUrl: pg.url, jwt });
  });

  afterAll(async () => {
    await target?.close();
    await jwt?.stop();
    await pg?.stop();
  });

  beforeEach(() => auditEntryRepository(target.app).clear());

  it('records an allowed request once, in feedback-service’s own database', async () => {
    const response = await signedGet(target.app, jwt, FEEDBACK_PATH);

    const [row] = await waitForOneRow(target.app);
    await settlePendingWrites();

    expect(response.status).toBe(200);
    expect(await auditRows(target.app)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({ method: 'GET', route: FEEDBACK_PATH, status: 200 });
  });

  it('records a request the auth guard rejected once, as a denial', async () => {
    const response = await anonymousGet(target.app, FEEDBACK_PATH);

    const [row] = await waitForOneRow(target.app);
    await settlePendingWrites();

    expect(response.status).toBe(401);
    expect(await auditRows(target.app)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({
      method: 'GET',
      route: FEEDBACK_PATH,
      status: 401,
      decision: 'denied',
      actorSub: null,
      credentialKind: 'none',
      via: 'anonymous',
    });
  });
});

/** One request through the real guard, carrying a token the local JWKS signed. */
async function signedGet(
  app: INestApplication,
  jwt: JwtHarness,
  path: string,
): Promise<request.Response> {
  const token = await jwt.sign(OWNER);
  return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
}

/** One request with no credential: the guard rejects it before any controller runs. */
function anonymousGet(app: INestApplication, path: string): Promise<request.Response> {
  return request(app.getHttpServer()).get(path);
}

/** The listener writes after the response ends, so the row is polled, not awaited. */
async function waitForOneRow(app: INestApplication): Promise<AuditEntry[]> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const rows = await auditRows(app);
    if (rows.length > 0) return rows;
    await settlePendingWrites();
  }
  throw new Error('expected one audit row, found none after polling');
}

function auditRows(app: INestApplication): Promise<AuditEntry[]> {
  return auditEntryRepository(app).find({ order: { occurredAt: 'ASC' } });
}

function auditEntryRepository(app: INestApplication) {
  return app.get(DataSource).getRepository(AuditEntry);
}

/** Let the fire-and-forget write finish. */
function settlePendingWrites(): Promise<void> {
  return sleep(POLL_INTERVAL_MS);
}
