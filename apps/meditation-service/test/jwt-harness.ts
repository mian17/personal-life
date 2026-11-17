import { createServer, type Server } from 'http';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

/**
 * Hermetic JWT harness: a loopback JWKS server over an ephemeral Ed25519 key
 * generated at runtime (never committed), so the route suites drive the real
 * global `AuthGuard` with real tokens instead of reaching around it.
 *
 * The env names are `meditation-service`'s own (`MEDITATION_IDP_JWKS_URL`,
 * `MEDITATION_SERVICE_AUDIENCE` — `src/service-config.ts`), and the audience is the
 * ecosystem-wide `life-api` the kernel token model issues. Same harness shape as
 * `apps/focus-service/test/jwt-harness.ts`.
 */
export const TEST_ISSUER = 'https://idp.test';
export const TEST_AUDIENCE = 'life-api';

/** Obviously-fake master key: a public test artifact, never a real secret. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 0x2d).toString('base64');

export class JwtTestHarness {
  private server?: Server;
  private privateKey?: CryptoKey;
  private jwk?: Record<string, unknown>;

  async start(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true });
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'key-1', alg: 'EdDSA', use: 'sig' };
    this.server = createServer((req, res) => {
      if (req.url !== '/jwks') {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [this.jwk] }));
    });
    await new Promise<void>((settle) => this.server!.listen(0, '127.0.0.1', settle));
    return this;
  }

  get jwksUrl(): string {
    const { port } = this.server!.address() as { port: number };
    return `http://127.0.0.1:${port}/jwks`;
  }

  /** Mints an access token whose `sub` is the owner every route is scoped by. */
  async sign(subject: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: subject })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(this.privateKey!);
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((settle) => this.server!.close(() => settle()));
  }
}
