import { appClient, assertOidcConfig, resolveAppClientSecret, staticClients } from '../src/oidc/clients';
import { audienceFor, defaultResource } from '../src/oidc/access-token.policy';

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
      expect([...(c.grant_types ?? [])].sort()).toEqual(['authorization_code', 'refresh_token']);
    }
  });

  it('uses OIDC_APP_REDIRECT_URIS for the app client when set', () => {
    const env: NodeJS.ProcessEnv = {
      OIDC_APP_REDIRECT_URIS: 'https://host.example.ts.net/auth/callback',
      OIDC_APP_CLIENT_SECRET: 's',
    };
    expect(appClient(env).redirect_uris).toEqual(['https://host.example.ts.net/auth/callback']);
  });

  it('defaults the app redirect to the dev callback outside production', () => {
    // Byte-identical to the app's dev default (apps/app/lib/auth/env.ts) so the
    // dance works with zero extra config.
    expect(appClient({ NODE_ENV: 'development' }).redirect_uris).toEqual([
      'http://127.0.0.1:3000/auth/callback',
    ]);
    expect(appClient({}).redirect_uris).toEqual(['http://127.0.0.1:3000/auth/callback']);
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
