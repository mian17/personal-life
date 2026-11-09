import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { UsersService } from '../src/users/users.service.js';

const TEST_DB = join(__dirname, 'test-idp-landing.db');
const TEST_KEYS = join(__dirname, 'test-idp-landing-keys.json');

process.env.DB_PATH = TEST_DB;
process.env.KEYS_PATH = TEST_KEYS;
process.env.IDP_ISSUER = 'http://127.0.0.1:3003';

async function startApp(): Promise<INestApplication> {
  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();
  await app.init();
  return app;
}

describe('GET /logout landing (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    app = await startApp();
    await app.get(UsersService).createUser('landing-user', 'fixture-password-not-a-secret');
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('renders a side-effect-free form that POSTs to the same-origin /logout', async () => {
    const res = await request(app.getHttpServer()).get('/logout').expect(200);
    expect(res.type).toBe('text/html');
    // The form posts to the IdP's own origin — that is what makes the cookie attach.
    expect(res.text).toContain('<form id="logout-form" method="post" action="/logout">');
    // It auto-submits so a plain GET navigation completes the logout with no click.
    expect(res.text).toContain("document.getElementById('logout-form').submit()");
  });

  it('does not revoke on GET: the session survives a landing render', async () => {
    const authed = await request(app.getHttpServer())
      .post('/login')
      .type('form')
      .send({ username: 'landing-user', password: 'fixture-password-not-a-secret' })
      .expect(200);
    const cookie = (authed.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    // The landing page itself must not mutate anything: the session still works.
    const landing = await request(app.getHttpServer())
      .get('/logout')
      .set('Cookie', cookie)
      .expect(200);
    expect(landing.text).toContain('<h1>Signing out');
    const stillSignedIn = await request(app.getHttpServer())
      .get('/')
      .set('Cookie', cookie)
      .expect(200);
    expect(stillSignedIn.text).toContain('Signed in as landing-user');

    // Only the POST ends it.
    const out = await request(app.getHttpServer())
      .post('/logout')
      .set('Cookie', cookie)
      .expect(303);
    expect(out.headers.location).toBe('/login');
    const afterLogout = await request(app.getHttpServer())
      .get('/')
      .set('Cookie', cookie)
      .expect(302);
    expect(afterLogout.headers.location).toBe('/login');
  });
});
