import 'reflect-metadata';
import {
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Res,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import request from 'supertest';
import http from 'node:http';
import { DataSource } from 'typeorm';
import {
  AUDIT_EMITTER,
  AUDIT_EVENT_NAME,
  AuditEntry,
  AuditMiddleware,
  AuditModule,
  UNMATCHED_ROUTE,
  type AuditEvent,
} from '../src/index.js';

/**
 * The capture seam, proven the way the capability claims it works: a real Nest
 * app over real Express, `AuditModule.forRoot()` writing its own rows, a guard of
 * the same shape every service registers, and a second subscriber recording what
 * was emitted.
 *
 * Middleware-before-guards is the point of the whole design (SPEC §8.3), so the
 * 401 and 403 assertions run through a guard, not a fake `next()`.
 */

const POLL_ATTEMPTS = 50;
const POLL_INTERVAL_MS = 10;

const AUDIT_COLUMNS = [
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

/** A guard that rejects without a bearer token and refuses nothing else. */
class RefusingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (!request.headers.authorization) throw new HttpException('unauthorized', 401);
    return true;
  }
}

@Controller()
class NotesController {
  @Get('notes/:id')
  readOne(): { id: string } {
    return { id: 'note-1' };
  }

  @Get('forbidden')
  refuse(): never {
    throw new ForbiddenException();
  }

  @Get('unfinished')
  leaveOpen(@Res() response: Response): void {
    // A response that is never sent: only a client abort can end this request.
    response.status(202);
  }
}

interface AuditHarness {
  app: INestApplication;
  events: AuditEvent[];
  waitForEvents: (count: number) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A full app: `AuditModule.forRoot()` over an in-memory database, plus whatever
 * guard a test wants. Every request the app serves writes into `events`.
 */
async function buildHarness(guard?: CanActivate): Promise<AuditHarness> {
  const events: AuditEvent[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [AuditEntry],
        synchronize: true,
      }),
      AuditModule.forRoot(),
    ],
    controllers: [NotesController],
  }).compile();

  const app = moduleRef.createNestApplication();
  if (guard) app.useGlobalGuards(guard);

  // The module's own listener stays subscribed and writes the rows; the recorder
  // is a second subscriber, so one request is asserted from both ends.
  const emitter = app.get<EventEmitter>(AUDIT_EMITTER);
  emitter.on(AUDIT_EVENT_NAME, (event: AuditEvent) => events.push(event));

  await app.init();
  return {
    app,
    events,
    waitForEvents: (count) => waitForEventCount(events, count),
    close: () => app.close(),
  };
}

/**
 * Poll until the recorder holds `count` events: the response is already over when
 * `finish` fires, so the listener runs after the response the test awaited.
 */
async function waitForEventCount(events: AuditEvent[], count: number): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    if (events.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

describe('AuditMiddleware over a real app', () => {
  let harness: AuditHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it('writes one audit row per allowed request through the module’s own listener', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer()).get('/notes/note-1').expect(200);
    await harness.waitForEvents(1);

    const rows = await harness.app.get(DataSource).getRepository(AuditEntry).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'GET', route: '/notes/:id', status: 200 });
    expect(Object.keys(rows[0]).sort()).toEqual([...AUDIT_COLUMNS, 'id'].sort());
  });

  it('emits exactly one event for a 401 guard rejection, with decision denied', async () => {
    harness = await buildHarness(new RefusingGuard());
    await request(harness.app.getHttpServer()).get('/notes/note-1').expect(401);
    await harness.waitForEvents(1);

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      status: 401,
      decision: 'denied',
      route: '/notes/:id',
    });
  });

  it('emits exactly one event for a 403 refusal, with decision denied', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer()).get('/forbidden').expect(403);
    await harness.waitForEvents(1);

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({ status: 403, decision: 'denied' });
  });

  it('stores the route template, never the concrete path', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer()).get('/notes/9f1c-concrete-id').expect(200);
    await harness.waitForEvents(1);

    expect(harness.events[0].route).toBe('/notes/:id');
    expect(JSON.stringify(harness.events[0])).not.toContain('9f1c-concrete-id');
  });

  it('stores the (unmatched) sentinel for a request no route matched', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer()).get('/nowhere/at-all').expect(404);
    await harness.waitForEvents(1);

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      route: UNMATCHED_ROUTE,
      status: 404,
      decision: 'error',
    });
    expect(JSON.stringify(harness.events[0])).not.toContain('/nowhere/at-all');
  });

  it('emits once on a client abort, with the status the response carried', async () => {
    harness = await buildHarness();
    // A supertest call ends its own listener when the response ends, so the abort
    // test needs a server that is listening first.
    await harness.app.listen(0);

    await abortUnfinishedRequest(harness.app.getHttpServer());
    await harness.waitForEvents(1);

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({ route: '/unfinished', status: 202 });
  });

  it('keeps a throwing listener out of the response: same status, same body', async () => {
    harness = await buildHarness();
    const emitter = harness.app.get<EventEmitter>(AUDIT_EMITTER);
    emitter.removeAllListeners(AUDIT_EVENT_NAME);
    emitter.on(AUDIT_EVENT_NAME, () => {
      throw new Error('listener exploded');
    });

    const response = await request(harness.app.getHttpServer()).get('/notes/note-1').expect(200);

    expect(response.body).toEqual({ id: 'note-1' });
  });

  it('takes the request id from the header, else mints one and attaches it', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer())
      .get('/notes/note-1')
      .set('x-request-id', 'inbound-request-7')
      .expect(200);
    await request(harness.app.getHttpServer()).get('/forbidden').expect(403);
    await harness.waitForEvents(2);

    expect(harness.events[0].requestId).toBe('inbound-request-7');
    expect(harness.events[1].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('stores no credential value, query string, or body substring', async () => {
    harness = await buildHarness();
    await request(harness.app.getHttpServer())
      .get('/notes/note-1?USDA_API_KEY=abc123')
      .set('Authorization', 'Bearer secret-bearer-token')
      .set('Cookie', 'session=cookie-value-42')
      .set('x-caller-service', 'tags-service')
      .set('User-Agent', 'probe/1.0')
      .send({ note: 'body-substring-marker' })
      .expect(200);
    await harness.waitForEvents(1);

    const stored = JSON.stringify(harness.events[0]);
    expect(stored).not.toContain('secret-bearer-token');
    expect(stored).not.toContain('cookie-value-42');
    expect(stored).not.toContain('abc123');
    expect(stored).not.toContain('body-substring-marker');
    expect(Object.keys(harness.events[0]).sort()).toEqual([...AUDIT_COLUMNS].sort());
    expect(harness.events[0]).toMatchObject({
      via: 'oidc-cookie',
      credentialKind: 'cookie',
      callerService: 'tags-service',
      userAgent: 'probe/1.0',
    });
  });
});

describe('AuditMiddleware without an emitter', () => {
  it('serves the request unchanged and throws nothing on the no-op path', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [NotesController] }).compile();
    const app = moduleRef.createNestApplication();
    app.use((request_: unknown, response_: unknown, next: () => void) => {
      new AuditMiddleware().use(request_ as never, response_ as never, next);
    });
    await app.init();

    const response = await request(app.getHttpServer()).get('/notes/note-1').expect(200);
    expect(response.body).toEqual({ id: 'note-1' });

    await app.close();
  });
});

/** Send a request, then hang up before the response is sent. */
function abortUnfinishedRequest(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      reject(new Error('test server is not listening on a port'));
      return;
    }
    const call = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: '/unfinished',
      method: 'GET',
    });
    call.on('error', () => resolve());
    call.on('response', () => resolve());
    call.end();
    setTimeout(() => {
      call.destroy();
      resolve();
    }, 50);
  });
}
