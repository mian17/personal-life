import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import {
  appClient,
  assertOidcConfig,
  resolveAppClientSecret,
  staticClients,
} from '../src/oidc/clients.js';
import { audienceFor, defaultResource } from '../src/oidc/access-token.policy.js';

describe('resolveAppClientSecret', () => {
  it('returns the configured secret when present', () => {
    expect(resolveAppClientSecret({ OIDC_APP_CLIENT_SECRET: 's' })).toBe('s');
  });

  it('throws in production when unset (no placeholder fallback)', () => {
    expect(() => resolveAppClientSecret({ NODE_ENV: 'production' })).toThrow(
      /OIDC_APP_CLIENT_SECRET must be set in production/,
    );
  });

  it('allows the obviously-fake placeholder outside production', () => {
    expect(resolveAppClientSecret({ NODE_ENV: 'development' })).toBe(
      'app-dev-client-secret-not-a-secret',
    );
    expect(resolveAppClientSecret({})).toBe('app-dev-client-secret-not-a-secret');
  });
});

describe('assertOidcConfig', () => {
  it('passes outside production without a secret', () => {
    expect(() => assertOidcConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('throws in production without the secret (fail fast at boot)', () => {
    expect(() => assertOidcConfig({ NODE_ENV: 'production' })).toThrow(
      /OIDC_APP_CLIENT_SECRET must be set in production/,
    );
  });

  it('passes in production with the secret', () => {
    expect(() =>
      assertOidcConfig({ NODE_ENV: 'production', OIDC_APP_CLIENT_SECRET: 's' }),
    ).not.toThrow();
  });
});

describe('static clients', () => {
  it('registers app (confidential) and dev (public), code-only with refresh', () => {
    const clients = staticClients();
    const app = clients.find((c) => c.client_id === 'app');
    const dev = clients.find((c) => c.client_id === 'dev');
    expect(app?.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(dev?.token_endpoint_auth_method).toBe('none');
    for (const c of clients) {
      expect(c.response_types).toEqual(['code']);
      expect([...(c.grant_types ?? [])].sort((a: string, b: string) => a.localeCompare(b))).toEqual(
        ['authorization_code', 'refresh_token'],
      );
    }
  });

  it('uses OIDC_APP_REDIRECT_URIS for the app client when set', () => {
    const env: NodeJS.ProcessEnv = {
      OIDC_APP_REDIRECT_URIS: 'https://host.example.ts.net/auth/callback',
      OIDC_APP_CLIENT_SECRET: 's',
    };
    expect(appClient(env).redirect_uris).toEqual(['https://host.example.ts.net/auth/callback']);
  });

  it('defaults the app redirect to both dev loopback spellings outside production', () => {
    // The app canonicalizes a loopback redirect to `localhost` (the host Next's
    // middleware puts the browser on), and a hand-run setup may still send
    // `127.0.0.1`, so both are registered with zero config.
    const expected = ['http://localhost:3000/auth/callback', 'http://127.0.0.1:3000/auth/callback'];
    expect(appClient({ NODE_ENV: 'development' }).redirect_uris).toEqual(expected);
    expect(appClient({}).redirect_uris).toEqual(expected);
  });

  it('keeps the production redirect default (:3002) under NODE_ENV=production', () => {
    expect(
      appClient({ NODE_ENV: 'production', OIDC_APP_CLIENT_SECRET: 's' }).redirect_uris,
    ).toEqual(['http://127.0.0.1:3002/auth/callback']);
  });

  it('lets an explicit OIDC_APP_REDIRECT_URIS win in both modes', () => {
    const explicit = { OIDC_APP_REDIRECT_URIS: 'https://x.ts.net/auth/callback' };
    expect(appClient({ NODE_ENV: 'development', ...explicit }).redirect_uris).toEqual([
      'https://x.ts.net/auth/callback',
    ]);
    expect(
      appClient({ NODE_ENV: 'production', OIDC_APP_CLIENT_SECRET: 's', ...explicit }).redirect_uris,
    ).toEqual(['https://x.ts.net/auth/callback']);
  });
});

describe('audience mapping (env-driven)', () => {
  afterEach(() => {
    delete process.env.OIDC_AUDIENCE_MAP;
    delete process.env.OIDC_DEFAULT_RESOURCE;
  });

  it('defaults preserve note-service', () => {
    expect(defaultResource()).toBe('https://note-service');
    expect(audienceFor('https://note-service')).toBe('note-service');
  });

  it('honours an explicit audience map, including a second service', () => {
    process.env.OIDC_AUDIENCE_MAP =
      'https://note-service=note-service,https://todo-service=todo-service';
    expect(audienceFor('https://note-service')).toBe('note-service');
    expect(audienceFor('https://todo-service')).toBe('todo-service');
  });

  it('honours an env-driven default resource', () => {
    process.env.OIDC_DEFAULT_RESOURCE = 'https://todo-service';
    expect(defaultResource()).toBe('https://todo-service');
  });

  it('falls back to the resource hostname when unmapped', () => {
    process.env.OIDC_AUDIENCE_MAP = 'https://other=x';
    expect(audienceFor('https://note-service.example/api')).toBe('note-service.example');
  });

  it('treats a plain service name as its own audience', () => {
    process.env.OIDC_AUDIENCE_MAP = 'https://other=x';
    expect(audienceFor('note-service')).toBe('note-service');
  });
});

/**
 * The enable-only protocol surface (SPEC-idp + decision 6). Every feature
 * outside discovery / code+PKCE / token / refresh rotation / JWKS must be off,
 * so the library's defaults cannot advertise or serve them. The `end_session`
 * (RP-initiated logout) endpoint is a FORBIDDEN item deferred to the multi-RP
 * chapter; this pins its absence so it cannot silently come back.
 */
describe('enabled protocol surface (discovery + routes)', () => {
  const TEST_DB = join(__dirname, 'test-idp-config-surface.db');
  const TEST_KEYS = join(__dirname, 'test-idp-config-surface-keys.json');
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_PATH = TEST_DB;
    process.env.KEYS_PATH = TEST_KEYS;
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  const absentEndpoints = [
    'end_session_endpoint',
    'pushed_authorization_request_endpoint',
    'userinfo_endpoint',
    'introspection_endpoint',
    'revocation_endpoint',
    'registration_endpoint',
    'device_authorization_endpoint',
    'backchannel_authentication_endpoint',
    'challenge_endpoint',
  ] as const;

  it('does not advertise any endpoint outside the enable-only set', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/openid-configuration')
      .expect(200);
    for (const key of absentEndpoints) {
      expect(res.body[key]).toBeUndefined();
    }
    // The endpoints that ARE part of the surface are advertised.
    expect(res.body.authorization_endpoint).toBeDefined();
    expect(res.body.token_endpoint).toBeDefined();
    expect(res.body.jwks_uri).toBeDefined();
    expect(res.body.issuer).toBeDefined();
  });

  it('404s every route outside the enabled surface', async () => {
    for (const path of [
      '/session/end',
      '/request',
      '/me',
      '/token/introspection',
      '/token/revocation',
      '/reg',
      '/device/auth',
      '/challenge',
      '/backchannel',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect([404, 405]).toContain(res.status);
    }
  });
});
