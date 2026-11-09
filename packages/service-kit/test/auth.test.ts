import 'reflect-metadata';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../src/auth/auth.guard.js';
import { IS_PUBLIC_KEY } from '../src/public.decorator.js';
import { resolveVerifierConfig } from '../src/auth/jwt-verifier.js';

/** Minimal `ExecutionContext` stub: the guard only reads the handler, class and request. */
function contextFor(req: Record<string, unknown>, isPublic = false): ExecutionContext {
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const ENV_NAMES = {
  jwksUrlEnv: 'TEST_IDP_JWKS_URL',
  audienceEnv: 'TEST_SERVICE_AUDIENCE',
};

describe('@life/service-kit AuthGuard', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedIssuer = process.env.IDP_ISSUER;

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedIssuer === undefined) delete process.env.IDP_ISSUER;
    else process.env.IDP_ISSUER = savedIssuer;
  });

  it('lets a @Public() route through without any credential', () => {
    process.env.NODE_ENV = 'production';
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    expect(guard.canActivate(contextFor({ headers: {} }, true))).toBe(true);
  });

  it('rejects a request with no bearer token', () => {
    process.env.NODE_ENV = 'production';
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', () => {
    process.env.NODE_ENV = 'production';
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    const ctx = contextFor({ headers: { authorization: 'Basic abc' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when verification is not configured (fail closed)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.IDP_ISSUER;
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    const ctx = contextFor({ headers: { authorization: 'Bearer token' } });
    await expect(Promise.resolve(guard.canActivate(ctx))).rejects.toThrow(UnauthorizedException);
  });

  it('bypasses verification only in development, stamping the dev principal', () => {
    process.env.NODE_ENV = 'development';
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    const req: Record<string, unknown> = { headers: {} };
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.principal).toEqual({ sub: 'dev-user' });
  });
});

describe('@life/service-kit verifier config', () => {
  it('reads the env names the service supplied, not a hardcoded pair', () => {
    const config = resolveVerifierConfig(ENV_NAMES, {
      IDP_ISSUER: 'https://idp.example',
      TEST_IDP_JWKS_URL: 'https://idp.example/custom-jwks',
      TEST_SERVICE_AUDIENCE: 'my-audience',
    } as NodeJS.ProcessEnv);
    expect(config.jwksUrl).toBe('https://idp.example/custom-jwks');
    expect(config.audience).toBe('my-audience');
    expect(config.clockToleranceS).toBe(30);
  });

  it('derives <IDP_ISSUER>/jwks and the shared audience when overrides are unset', () => {
    const config = resolveVerifierConfig(ENV_NAMES, {
      IDP_ISSUER: 'https://idp.example',
    } as NodeJS.ProcessEnv);
    expect(config.jwksUrl).toBe('https://idp.example/jwks');
    expect(config.audience).toBe('life-api');
  });

  it('fails when IDP_ISSUER is missing', () => {
    expect(() => resolveVerifierConfig(ENV_NAMES, {} as NodeJS.ProcessEnv)).toThrow(/IDP_ISSUER/);
  });
});
