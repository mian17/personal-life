import { INestApplication } from '@nestjs/common';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditEntry } from '@life/service-kit';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * Wiring proof for the audit capability in tags-service (SPEC-audit-log §8.2,
 * §8.10). The behavior lives in `@life/service-kit` and is proven once by
 * note-service's reference suite; this suite only proves that importing
 * `AuditModule.forRoot()` and registering `AuditEntry` here is enough.
 *
 * One allowed request and one guard rejection, each landing exactly one row in
 * this service's own database.
 */

const TEST_DB = join(import.meta.dirname, 'test-audit.db');
const BASE_NODE_ENV = 'test';

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

describe('Audit log wiring (e2e)', () => {
  let app: INestApplication;
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
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  beforeEach(() => auditEntryRepository(app).clear());

  it('records an allowed request once, in tags-service’s own database', async () => {
    const response = await signedGet(app, harness, '/api/tags');

    const [row] = await waitForOneRow(app);
    await settlePendingWrites();

    expect(response.status).toBe(200);
    expect(await auditRows(app)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({ method: 'GET', route: '/api/tags', status: 200 });
  });

  it('records a request the auth guard rejected once, as a denial', async () => {
    const response = await anonymousGet(app, '/api/tags');

    const [row] = await waitForOneRow(app);
    await settlePendingWrites();

    expect(response.status).toBe(401);
    expect(await auditRows(app)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({
      method: 'GET',
      route: '/api/tags',
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
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
