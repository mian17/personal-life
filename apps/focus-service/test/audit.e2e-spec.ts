import request from 'supertest';
import { AuditEntry } from '@life/service-kit';
import { JwtTestHarness } from './jwt-harness.js';
import {
  startFocusApp,
  startThrowawayDatabase,
  type FocusApp,
  type ThrowawayDatabase,
} from './setup-env.js';

/**
 * Wiring proof for the audit capability in focus-service (SPEC-audit-log §8.2,
 * §8.10). The behavior lives in `@life/service-kit` and is proven once by
 * note-service's reference suite; this suite only proves that importing
 * `AuditModule.forRoot()` and registering `AuditEntry` here is enough.
 *
 * One allowed request and one guard rejection, each landing exactly one row in
 * this service's own database — a throwaway temp file, never `data/focus.db`.
 */

const OWNER = 'test-user';

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
  let harness: JwtTestHarness;
  let database: ThrowawayDatabase;
  let service: FocusApp;

  beforeAll(async () => {
    harness = await new JwtTestHarness().start();
    database = await startThrowawayDatabase('audit');
    service = await startFocusApp({ databasePath: database.path, jwksUrl: harness.jwksUrl });
  });

  afterAll(async () => {
    await service.close();
    await harness.stop();
    await database.stop();
  });

  beforeEach(() => service.dataSource.getRepository(AuditEntry).clear());

  it('records an allowed request once, in focus-service’s own database', async () => {
    const response = await signedGet(service, harness, '/api/goal');

    const [row] = await waitForOneRow(service);
    await settlePendingWrites();

    expect(response.status).toBe(200);
    expect(await auditRows(service)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({
      method: 'GET',
      route: '/api/goal',
      status: 200,
      decision: 'allowed',
      actorSub: OWNER,
      credentialKind: 'bearer',
      via: 'bearer',
    });
  });

  it('records a request the auth guard rejected once, as a denial', async () => {
    const response = await anonymousGet(service, '/api/goal');

    const [row] = await waitForOneRow(service);
    await settlePendingWrites();

    expect(response.status).toBe(401);
    expect(await auditRows(service)).toHaveLength(1);
    expect(Object.keys(row).sort()).toEqual([...AUDIT_FIELDS].sort());
    expect(row).toMatchObject({
      method: 'GET',
      route: '/api/goal',
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
  service: FocusApp,
  harness: JwtTestHarness,
  path: string,
): Promise<request.Response> {
  const token = await harness.sign(OWNER);
  return request(service.app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
}

/** One request with no credential: the guard rejects it before any controller runs. */
function anonymousGet(service: FocusApp, path: string): Promise<request.Response> {
  return request(service.app.getHttpServer()).get(path);
}

/** The listener writes after the response ends, so the row is polled, not awaited. */
async function waitForOneRow(service: FocusApp): Promise<AuditEntry[]> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const rows = await auditRows(service);
    if (rows.length > 0) return rows;
    await settlePendingWrites();
  }
  throw new Error('expected one audit row, found none after polling');
}

function auditRows(service: FocusApp): Promise<AuditEntry[]> {
  return service.dataSource.getRepository(AuditEntry).find({ order: { occurredAt: 'ASC' } });
}

/** Let the fire-and-forget write finish. */
function settlePendingWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
