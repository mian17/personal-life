import { createServer, type Server } from 'http';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

/**
 * Hermetic JWT test harness: a local HTTP JWKS server backed by ephemeral
 * Ed25519 keys generated at runtime (never committed). Used by the auth and
 * notes e2e suites so both exercise the real guard with the same token machinery.
 */

export const TEST_ISSUER = 'https://idp.test';
export const TEST_AUDIENCE = 'note-service';

export interface TestKey {
  privateKey: CryptoKey;
  jwk: Record<string, unknown>;
  kid: string;
}

async function newKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, kid, jwk: { ...publicJwk, kid, alg: 'EdDSA', use: 'sig' } };
}

export interface SignOptions {
  issuer?: string;
  audience?: string;
  expiresIn?: number;
  kid?: string;
  subject?: string;
}

export class JwtTestHarness {
  private server?: Server;
  keys: TestKey[] = [];

  /** Serves the *current* key set, so tests can rotate keys mid-run. */
  private handler = (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    if (req.url === '/jwks') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: this.keys.map((k) => k.jwk) }));
      return;
    }
    res.statusCode = 404;
    res.end();
  };

  async start(): Promise<this> {
    this.keys = [await newKey('key-1')];
    this.server = createServer(this.handler);
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    return this;
  }

  get jwksUrl(): string {
    const port = (this.server!.address() as { port: number }).port;
    return `http://127.0.0.1:${port}/jwks`;
  }

  /** Adds a fresh key (rotation) and returns it. */
  async rotate(prefix = 'key'): Promise<TestKey> {
    const key = await newKey(`${prefix}-${Date.now()}`);
    this.keys = [...this.keys, key];
    return key;
  }

  /** Mints a token; defaults to the first (primary) key. */
  async sign(options: SignOptions = {}): Promise<string> {
    const key = options.kid
      ? this.keys.find((k) => k.kid === options.kid) ?? this.keys[0]
      : this.keys[0];
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: options.subject ?? 'test-user' })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresIn ?? 600))
      .sign(key.privateKey);
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
}

/** Applies the harness's issuer/JWKS env to the process for a running app. */
export function configureVerifierEnv(harness: JwtTestHarness): void {
  process.env.IDP_ISSUER = TEST_ISSUER;
  process.env.IDP_JWKS_URL = harness.jwksUrl;
  process.env.NOTE_SERVICE_AUDIENCE = TEST_AUDIENCE;
  // Make rotation deterministic: an unknown kid refetches immediately.
  process.env.IDP_JWKS_COOLDOWN_MS = '0';
}
