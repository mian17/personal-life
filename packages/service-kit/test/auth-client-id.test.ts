import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard.js';
import type { AuthenticatedRequest } from '../src/auth/principal.js';

/**
 * Client-id seam: the guard must carry the verified token's `client_id` into the
 * principal (or `null` when the token has none), and the development bypass must
 * cover only a request that presents no credentials. Driven through the real
 * guard against real tokens signed by a loopback JWKS, never a stubbed verifier.
 */

const ISSUER = 'https://idp.test';
const ENV_NAMES = { jwksUrlEnv: 'SEAM_IDP_JWKS_URL', audienceEnv: 'SEAM_SERVICE_AUDIENCE' };

/** A public test key set served over loopback; the signing key never leaves the test. */
class TestKeySet {
  private server?: Server;
  private signingKey?: CryptoKey;

  async start(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true });
    this.signingKey = privateKey;
    const jwk = { ...(await exportJWK(publicKey)), kid: 'key-1', alg: 'EdDSA', use: 'sig' };
    this.server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((settle) => this.server!.listen(0, '127.0.0.1', settle));
    return this;
  }

  get jwksUrl(): string {
    const { port } = this.server!.address() as { port: number };
    return `http://127.0.0.1:${port}/jwks`;
  }

  async sign(claims: { sub: string; client_id?: string }): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience('life-api')
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 600)
      .sign(this.signingKey!);
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((settle) => this.server!.close(() => settle()));
  }
}

/** Minimal `ExecutionContext`: the guard reads only the handler, class and request. */
function requestContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('@life/service-kit AuthGuard client id', () => {
  const keys = new TestKeySet();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await keys.start();
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.IDP_ISSUER = ISSUER;
    process.env[ENV_NAMES.jwksUrlEnv] = keys.jwksUrl;
    process.env[ENV_NAMES.audienceEnv] = 'life-api';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  afterAll(async () => {
    await keys.stop();
  });

  function principalAfterGuard(request: Partial<AuthenticatedRequest>): Promise<unknown> {
    const guard = new AuthGuard(ENV_NAMES, new Reflector());
    return Promise.resolve(guard.canActivate(requestContext(request))).then(
      () => request.principal,
    );
  }

  it('stamps the verified client_id claim onto the principal', async () => {
    const token = await keys.sign({ sub: 'alice', client_id: 'producer-app' });

    const principal = await principalAfterGuard({ headers: { authorization: `Bearer ${token}` } });

    expect(principal).toEqual({ sub: 'alice', clientId: 'producer-app' });
  });

  it('leaves clientId null when the verified token carries no client_id claim', async () => {
    const token = await keys.sign({ sub: 'alice' });

    const principal = await principalAfterGuard({ headers: { authorization: `Bearer ${token}` } });

    expect(principal).toEqual({ sub: 'alice', clientId: null });
  });

  it('verifies a presented token in development instead of shortcutting to dev-user', async () => {
    process.env.NODE_ENV = 'development';
    const token = await keys.sign({ sub: 'alice', client_id: 'producer-app' });

    const principal = await principalAfterGuard({ headers: { authorization: `Bearer ${token}` } });

    expect(principal).toEqual({ sub: 'alice', clientId: 'producer-app' });
  });

  it('grants the dev-user principal in development only when no credential is presented', async () => {
    process.env.NODE_ENV = 'development';

    const principal = await principalAfterGuard({ headers: {} });

    expect(principal).toEqual({ sub: 'dev-user', clientId: null });
  });
});
