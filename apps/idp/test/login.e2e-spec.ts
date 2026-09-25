import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Session } from '../src/sessions/session.entity';
import { UsersService } from '../src/users/users.service';

const FIXTURE_PASSWORD = 'fixture-password-not-a-secret';
const COOKIE = 'idp_session';

function sessionCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const parts = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return parts.find((c) => c.startsWith(`${COOKIE}=`))?.split(';')[0];
}

function rawToken(cookie: string): string {
  return decodeURIComponent(cookie.slice(COOKIE.length + 1));
}

describe('Login and sessions (e2e)', () => {
  const TEST_DB = join(__dirname, 'test-idp-login.db');
  const TEST_KEYS = join(__dirname, 'test-idp-login-keys.json');
  process.env.DB_PATH = TEST_DB;
  process.env.KEYS_PATH = TEST_KEYS;

  let app: INestApplication;
  let users: UsersService;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    users = app.get(UsersService);
    await users.createUser('alice', FIXTURE_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  const login = (username: string, password: string) =>
    request(app.getHttpServer()).post('/login').type('form').send({ username, password });

  it('GET /login renders the form', async () => {
    const res = await request(app.getHttpServer()).get('/login').expect(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('<form method="post" action="/login">');
  });

  it('login success sets an HttpOnly session cookie and GET / returns 200', async () => {
    const res = await login('alice', FIXTURE_PASSWORD).expect(200);
    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();

    const home = await request(app.getHttpServer()).get('/').set('Cookie', cookie!).expect(200);
    expect(home.text).toContain('Signed in as alice');
  });

  it('unknown user and wrong password produce identical failures', async () => {
    const unknown = await login('nobody', FIXTURE_PASSWORD);
    const wrong = await login('alice', 'not-the-password');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.text).toBe(wrong.text);
    expect(unknown.text).toContain('Invalid username or password');
    expect(sessionCookie(unknown)).toBeUndefined();
    expect(sessionCookie(wrong)).toBeUndefined();
  });

  it('sets HttpOnly and SameSite=Lax and no Secure in dev', async () => {
    const res = await login('alice', FIXTURE_PASSWORD).expect(200);
    const header = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${COOKIE}=`),
    );
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
  });

  it('logout clears the cookie and kills the server-side session', async () => {
    const res = await login('alice', FIXTURE_PASSWORD).expect(200);
    const cookie = sessionCookie(res)!;
    await request(app.getHttpServer()).get('/').set('Cookie', cookie).expect(200);

    const out = await request(app.getHttpServer()).post('/logout').set('Cookie', cookie).expect(303);
    const cleared = (out.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${COOKIE}=`),
    );
    expect(cleared).toBeDefined();
    expect(cleared).toContain(`${COOKIE}=;`);
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');

    // Replaying the old token is rejected: the row is gone server-side.
    await request(app.getHttpServer()).get('/').set('Cookie', cookie).expect(302);
  });

  it('rejects an expired session', async () => {
    const res = await login('alice', FIXTURE_PASSWORD).expect(200);
    const cookie = sessionCookie(res)!;
    const tokenHash = createHash('sha256').update(rawToken(cookie)).digest('hex');

    const dataSource = app.get(DataSource);
    await dataSource
      .getRepository(Session)
      .update({ tokenHash }, { expiresAt: new Date(Date.now() - 1000) });

    await request(app.getHttpServer())
      .get('/')
      .set('Cookie', cookie)
      .expect(302)
      .expect('Location', '/login');
  });

  it('redirects GET / to /login without a session', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(302)
      .expect('Location', '/login');
  });

  it('treats a malformed session cookie as absent (login redirect, not a 500)', async () => {
    // A stray `%` is invalid percent-encoding; decoding it throws URIError. The
    // parser must fail closed to "no cookie" so GET / redirects to /login.
    await request(app.getHttpServer())
      .get('/')
      .set('Cookie', `${COOKIE}=%`)
      .expect(302)
      .expect('Location', '/login');
    await request(app.getHttpServer())
      .post('/logout')
      .set('Cookie', `${COOKIE}=%`)
      .expect(303);
  });
});

describe('Raw session storage (e2e)', () => {
  const RAW_DB = join(__dirname, 'test-idp-login-raw.db');

  afterAll(() => rmSync(RAW_DB, { force: true }));

  it('never writes the raw session token to the database file', async () => {
    jest.resetModules();
    rmSync(RAW_DB, { force: true });
    process.env.DB_PATH = RAW_DB;

    const [{ createApp }, { UsersService: FreshUsersService }] = await Promise.all([
      import('../src/app.factory'),
      import('../src/users/users.service'),
    ]);

    const app = await createApp();
    await app.init();
    const users = app.get(FreshUsersService);

    let token = '';
    try {
      await users.createUser('raw-user', FIXTURE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post('/login')
        .type('form')
        .send({ username: 'raw-user', password: FIXTURE_PASSWORD })
        .expect(200);
      token = rawToken(sessionCookie(res)!);
    } finally {
      await app.close();
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const bytes = readFileSync(RAW_DB);
    expect(bytes.includes(token)).toBe(false);
    expect(bytes.includes(tokenHash)).toBe(true);
  });
});
