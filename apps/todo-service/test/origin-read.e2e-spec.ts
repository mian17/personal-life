import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FOCUS_TODO_DISCLOSURE, OriginGrant, disclosureHash } from '@life/service-kit';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness.js';

/**
 * `GET /api/todos/origin/open` — the read direction over HTTP
 * (`SPEC-todo-origin`, read grant).
 *
 * Boots the real app (global `AuthGuard`, real JWKS verification, real sqlite) so
 * the grant lookup and the owner filter both come from the verified token exactly
 * as they do in production. The three cases that matter:
 *
 *   1. no read grant is a 403, never an empty list — a consumer that mistook "not
 *      allowed" for "nothing to do" would show an empty screen forever;
 *   2. `scope: 'all'` sees every open task and no done or trashed one;
 *   3. `scope: 'own-origin'` sees only the rows its own origin created.
 *
 * Plus the compatibility case that motivated the primary-key change: the same
 * `(owner, client)` pair holding a meals write grant and a focus read grant, which
 * is the production shape because the BFF presents one `client_id` (`app`) for
 * every app it proxies.
 */

const TEST_DB = join(import.meta.dirname, 'test-origin-read.db');

const BASE_NODE_ENV = 'test';
const APP_USER = 'user-a';
const OTHER_USER = 'user-b';
/** The client the BFF's own access token names (`apps/idp/src/oidc/clients.ts`). */
const APP_CLIENT = 'app';
const MEAL = 'meal-service';
const FOCUS = 'focus-service';

const auth = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('Read grant over HTTP (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let harness: JwtTestHarness;
  let originalEnv: NodeJS.ProcessEnv;
  let appToken = '';
  let otherToken = '';
  let clientlessToken = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = BASE_NODE_ENV;
    process.env.DB_PATH = TEST_DB;

    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    appToken = await harness.sign({ subject: APP_USER, clientId: APP_CLIENT });
    otherToken = await harness.sign({ subject: OTHER_USER, clientId: APP_CLIENT });
    clientlessToken = await harness.sign({ subject: APP_USER });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
    process.env = originalEnv;
  });

  afterEach(async () => {
    await dataSource.getRepository(OriginGrant).clear();
    await dataSource.query('DELETE FROM "todo_tag"');
    await dataSource.query('DELETE FROM "todo_completion"');
    await dataSource.query('DELETE FROM "todo"');
  });

  const server = () => app.getHttpServer();
  const readOpen = (token = appToken) =>
    auth(request(server()).get('/api/todos/origin/open'), token);
  const grant = (body: Record<string, unknown>, token = appToken) =>
    auth(request(server()).post('/api/todos/origin-grant'), token).send(body);
  const create = (body: Record<string, unknown>, token = appToken) =>
    auth(request(server()).post('/api/todos'), token).send(body);
  const createWithOrigin = (body: Record<string, unknown>, token = appToken) =>
    auth(request(server()).post('/api/todos/origin'), token).send(body);
  const rows = () => dataSource.getRepository(OriginGrant).find();

  /** Provision a read grant out of band, the way the CLI or another route would. */
  const insertReadGrant = (ownerSub: string, scope: 'own-origin' | 'all') =>
    dataSource.getRepository(OriginGrant).insert({
      ownerSub,
      clientId: APP_CLIENT,
      direction: 'read',
      originService: FOCUS,
      scope,
      grantedAt: new Date(),
    });

  it('answers 403 to a client holding no read grant, and no empty list', async () => {
    await create({ title: 'something open' });

    const response = await readOpen();

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('No read grant for this client');
    // Not an empty list: "you may not read" and "you may read nothing" differ.
    expect(Array.isArray(response.body)).toBe(false);
  });

  it('answers 403 to a token that names no client', async () => {
    // Without a `client_id` there is no grantee, so no grant can match — the same
    // fail-closed rule the grant route and the write path apply.
    const response = await readOpen(clientlessToken);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('No read grant for this client');
  });

  it("lists every open task of the owner under scope 'all', and no done or trashed one", async () => {
    await insertReadGrant(APP_USER, 'all');
    const open = await create({ title: 'open task' });
    const done = await create({ title: 'done task' });
    const trashed = await create({ title: 'trashed task' });
    await auth(request(server()).patch(`/api/todos/${done.body.id}`), appToken).send({
      done: true,
    });
    await auth(request(server()).delete(`/api/todos/${trashed.body.id}`), appToken);

    const response = await readOpen();

    expect(response.status).toBe(200);
    expect(response.body.map((todo: { id: string }) => todo.id)).toEqual([open.body.id]);
  });

  it("narrows to the grant's own origin under scope 'own-origin'", async () => {
    await insertReadGrant(APP_USER, 'own-origin');
    // A write grant lets the producer create; the read grant above is what this is
    // reading through, and only this producer's own rows may appear.
    await dataSource.getRepository(OriginGrant).insert({
      ownerSub: APP_USER,
      clientId: APP_CLIENT,
      direction: 'write',
      originService: FOCUS,
      scope: null,
      grantedAt: new Date(),
    });
    const mine = await createWithOrigin({ title: 'mine', originId: 'focus-1' });
    await create({ title: 'hand-written' });

    const response = await readOpen();

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: mine.body.id,
      title: 'mine',
      originService: FOCUS,
      originId: 'focus-1',
    });
  });

  it("never answers another owner's tasks, even with the same client id", async () => {
    await insertReadGrant(APP_USER, 'all');
    await insertReadGrant(OTHER_USER, 'all');
    const theirs = await create({ title: 'their task' }, otherToken);

    const response = await readOpen();

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    // The row exists — it is the owner filter, not an empty table, that hid it.
    expect(theirs.status).toBe(201);
  });

  it('returns the shape a consumer needs: id, title, dueDate, done, version, origin columns', async () => {
    await insertReadGrant(APP_USER, 'all');
    const created = await create({ title: 'with due', dueDate: '2026-02-03' });

    const response = await readOpen();

    expect(response.status).toBe(200);
    expect(response.body[0]).toEqual({
      id: created.body.id,
      title: 'with due',
      dueDate: '2026-02-03',
      done: false,
      version: 0,
      originService: null,
      originId: null,
    });
  });

  it('ignores query parameters that try to widen the scope', async () => {
    // `scope`, `ownerSub` and `originService` mean nothing on this route: the reach
    // is the grant's. A request naming them must not change the answer.
    await insertReadGrant(APP_USER, 'own-origin');
    await create({ title: 'hand-written' });

    const response = await request(server())
      .get('/api/todos/origin/open?scope=all&ownerSub=user-b&originService=meal-service')
      .set('Authorization', `Bearer ${appToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('mutates nothing', async () => {
    await insertReadGrant(APP_USER, 'all');
    const created = await create({ title: 'untouched' });
    const before = await dataSource.query('SELECT "version", "done", "deletedAt" FROM "todo"');

    await readOpen();

    const after = await dataSource.query('SELECT "version", "done", "deletedAt" FROM "todo"');
    expect(after).toEqual(before);
    expect(created.status).toBe(201);
  });

  it('keeps the meals write grant when the same pair also gains a focus read grant', async () => {
    // The production shape: one `client_id` (`app`) for every app. Granting focus
    // read must not overwrite the meals write row — and meals must still be able to
    // create through its own route afterwards.
    const write = await grant({ originService: MEAL });
    const read = await grant({ originService: FOCUS });

    expect(write.status).toBe(201);
    expect(write.body.direction).toBe('write');
    expect(read.status).toBe(201);
    expect(read.body.direction).toBe('read');

    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(
      stored
        .map((row) => [row.direction, row.originService])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['read', FOCUS],
      ['write', MEAL],
    ]);
    // The read grant records its reach; the write grant carries none.
    expect(stored.find((row) => row.direction === 'read')?.scope).toBe('all');
    expect(stored.find((row) => row.direction === 'write')?.scope).toBeNull();

    // And the write capability still works after the second grant.
    const created = await createWithOrigin({ title: 'meal task', originId: 'meal-1' });
    expect(created.status).toBe(201);
    expect(created.body.originService).toBe(MEAL);
  });

  it('records the focus disclosure verbatim when the grant route writes it', async () => {
    await grant({ originService: FOCUS });

    const [stored] = await rows();
    expect(stored.disclosure).toBe(FOCUS_TODO_DISCLOSURE);
    expect(stored.disclosureHash).toBe(disclosureHash(FOCUS_TODO_DISCLOSURE));
  });

  it('treats a row written without a direction as the write grant it always was', async () => {
    // The compatibility case this change must not break: a database provisioned
    // before `direction` existed inserts only the four original columns, and the
    // column default must make that row a write grant. Inserted through raw SQL so
    // the default, not the writer, is what is under test.
    await dataSource.query(
      'INSERT INTO "origin_grant" ("ownerSub", "clientId", "originService", "grantedAt") ' +
        'VALUES (?, ?, ?, ?)',
      [APP_USER, APP_CLIENT, MEAL, '2026-01-01 00:00:00.000'],
    );

    const [stored] = await rows();
    expect(stored.direction).toBe('write');
    expect(stored.scope).toBeNull();

    // And the write path reads it exactly as it always did.
    const created = await createWithOrigin({ title: 'legacy grant', originId: 'meal-legacy' });
    expect(created.status).toBe(201);
    expect(created.body.originService).toBe(MEAL);
  });

  it('refuses a body that names its own direction or scope', async () => {
    // The route decides both from the origin. A body naming either would be granting
    // itself a capability no settings screen offered.
    const withDirection = await grant({ originService: FOCUS, direction: 'write' });
    const withScope = await grant({ originService: FOCUS, scope: 'all' });

    expect(withDirection.status).toBe(400);
    expect(withScope.status).toBe(400);
    expect(await rows()).toEqual([]);
  });
});
