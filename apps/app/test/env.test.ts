import { getAuthEnv, getIdpIssuer, validateAuthEnv, type AuthEnv } from '@/lib/auth/env';

const baseEnv = { NODE_ENV: 'development' };
const valid: AuthEnv = {
  issuer: 'https://host.example.ts.net:8443',
  clientId: 'app',
  clientSecret: 's',
  redirectUri: 'https://host.example.ts.net/auth/callback',
  resource: 'https://note-service',
};

describe('getAuthEnv', () => {
  it('uses dev defaults outside production', () => {
    const env = getAuthEnv(baseEnv);
    expect(env.issuer).toBe('http://127.0.0.1:3003');
    expect(env.clientId).toBe('app');
    expect(env.clientSecret).toBe('app-dev-client-secret-not-a-secret');
    expect(env.resource).toBe('https://note-service');
  });

  it('requires OIDC_APP_CLIENT_SECRET in production (no fallback)', () => {
    expect(() => getAuthEnv({ NODE_ENV: 'production' })).toThrow(
      /OIDC_APP_CLIENT_SECRET must be set in production/,
    );
  });

  it('accepts an explicit production secret', () => {
    const env = getAuthEnv({
      NODE_ENV: 'production',
      OIDC_APP_CLIENT_SECRET: 'prod-secret-not-a-secret',
      OIDC_APP_REDIRECT_URI: 'https://host.example.ts.net/auth/callback',
    });
    expect(env.clientSecret).toBe('prod-secret-not-a-secret');
  });
});

describe('validateAuthEnv', () => {
  it('accepts a valid production config', () => {
    expect(() => validateAuthEnv(valid, { NODE_ENV: 'production' })).not.toThrow();
  });

  it('rejects a non-absolute issuer', () => {
    expect(() =>
      validateAuthEnv({ ...valid, issuer: 'not-a-url' }, { NODE_ENV: 'production' }),
    ).toThrow(/IDP_ISSUER must be an absolute URL/);
  });

  it('rejects a non-absolute redirect URI', () => {
    expect(() =>
      validateAuthEnv({ ...valid, redirectUri: '/auth/callback' }, { NODE_ENV: 'production' }),
    ).toThrow(/absolute URL/);
  });

  it('rejects a redirect URI that is not the callback path', () => {
    expect(() =>
      validateAuthEnv(
        { ...valid, redirectUri: 'https://host.example.ts.net/wrong' },
        { NODE_ENV: 'production' },
      ),
    ).toThrow(/must end with \/auth\/callback/);
  });

  it('warns (does not throw) for a non-https non-loopback production redirect', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() =>
      validateAuthEnv(
        { ...valid, redirectUri: 'http://host.example.ts.net/auth/callback' },
        { NODE_ENV: 'production' },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('allows an http loopback redirect URI in production without warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() =>
      validateAuthEnv(
        { ...valid, redirectUri: 'http://127.0.0.1:3100/auth/callback' },
        { NODE_ENV: 'production' },
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('allows an http loopback redirect URI in development', () => {
    expect(() =>
      validateAuthEnv(
        { ...valid, redirectUri: 'http://127.0.0.1:3000/auth/callback' },
        { NODE_ENV: 'development' },
      ),
    ).not.toThrow();
  });
});

describe('getIdpIssuer', () => {
  it('defaults to the local IdP and honours the env var', () => {
    expect(getIdpIssuer({})).toBe('http://127.0.0.1:3003');
    expect(getIdpIssuer({ IDP_ISSUER: 'https://host.example.ts.net:8443' })).toBe(
      'https://host.example.ts.net:8443',
    );
  });
});
