/**
 * Token-provider suite (SPEC-ops-agent-contract §3.5): the MCP adapter's
 * refreshing read. A token outside the skew window passes through untouched; one
 * inside it rotates once through `refresh()` against the stub IdP, which is what
 * persists the rotated pair. Every failure — no store, no refresh token, a
 * refused grant, a throwing issuer — reads as `undefined`, and concurrent readers
 * share one rotation.
 *
 * The suite is also the boundary check: `mcp/server` gets the refreshing read,
 * an executor wired as `cli/run.ts` wires it keeps the plain store read and never
 * rotates. No test contacts the real IdP.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { login } from '../src/auth/login';
import { currentAccessToken } from '../src/auth/token-provider';
import { readToken, readTokens, storeTokens } from '../src/auth/token-store';
import { sampleRegistry } from '../src/fixtures/sample';
import { createMcpServer } from '../src/mcp/server';
import { createExecutor } from '../src/transport/executor';
import { sampleApiToken, startStubApi, type StubApi } from './support/stub-api';
import { startStubIdp, type StubIdp } from './support/stub-idp';

const ONE_HOUR_MS = 3_600_000;
const TEN_MINUTES_MS = 600_000;
/** Inside the default 60 s window: this token is due a rotation. */
const EXPIRING_SOON_MS = 1_000;
/** Wider than an hour, so a freshly rotated pair is inside the window too. */
const ALWAYS_ROTATE_SKEW_MS = String(2 * ONE_HOUR_MS);

let idp: StubIdp;
let api: StubApi;
let credentialDirectory = '';
let savedCredentialsPath: string | undefined;
let savedIssuer: string | undefined;
let savedSkew: string | undefined;

beforeEach(async () => {
  credentialDirectory = mkdtempSync(join(tmpdir(), 'life-ops-token-provider-'));
  idp = await startStubIdp();
  api = await startStubApi({ ownerSubject: 'owner-1' });
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  savedIssuer = process.env.IDP_ISSUER;
  savedSkew = process.env.LIFE_OPS_REFRESH_SKEW_MS;
  process.env.LIFE_OPS_CREDENTIALS_PATH = join(credentialDirectory, 'credentials.json');
  process.env.IDP_ISSUER = idp.issuer;
  delete process.env.LIFE_OPS_REFRESH_SKEW_MS;
});

afterEach(async () => {
  restore('LIFE_OPS_CREDENTIALS_PATH', savedCredentialsPath);
  restore('IDP_ISSUER', savedIssuer);
  restore('LIFE_OPS_REFRESH_SKEW_MS', savedSkew);
  rmSync(credentialDirectory, { recursive: true, force: true });
  await api.stop();
  await idp.stop();
});

describe('a token outside the skew window', () => {
  it('is returned as stored, with no rotation', async () => {
    await storeTokens({ accessToken: sampleApiToken, refreshToken: 'stub.refresh.token', expiresAt: Date.now() + ONE_HOUR_MS });

    expect(await currentAccessToken()).toBe(sampleApiToken);
    expect(idp.rotations()).toBe(0);
  });
});

describe('a token inside the skew window', () => {
  it('rotates once and returns the rotated access token', async () => {
    await storeExpiringTokens();

    const accessToken = await currentAccessToken();

    expect(idp.rotations()).toBe(1);
    expect(accessToken).not.toBe(sampleApiToken);
    expect(accessToken).toBe((await readTokens())?.accessToken);
  });

  it('leaves the pair refresh wrote persisted, not one the provider assembled', async () => {
    await storeExpiringTokens();
    const refreshTokenBeforeRotation = (await readTokens())?.refreshToken;

    const accessToken = await currentAccessToken();
    const persisted = await readTokens();

    expect(persisted).toEqual({
      accessToken,
      refreshToken: expect.any(String),
      expiresAt: expect.any(Number),
    });
    expect(persisted?.refreshToken).not.toBe(refreshTokenBeforeRotation);
    expect(persisted?.expiresAt).toBeGreaterThan(Date.now() + TEN_MINUTES_MS);
  });
});

describe('refreshing cannot happen', () => {
  it('answers undefined when the store holds no tokens', async () => {
    expect(await currentAccessToken()).toBeUndefined();
  });

  it('answers undefined without rotating when the store holds no refresh token', async () => {
    await storeTokens({ accessToken: sampleApiToken, refreshToken: undefined, expiresAt: Date.now() + EXPIRING_SOON_MS });

    expect(await currentAccessToken()).toBeUndefined();
    expect(idp.rotations()).toBe(0);
  });

  it('answers undefined when the IdP refuses the grant', async () => {
    await storeTokens({ accessToken: sampleApiToken, refreshToken: 'not-a-live-refresh', expiresAt: Date.now() + EXPIRING_SOON_MS });

    expect(await currentAccessToken()).toBeUndefined();
    expect(idp.rotations()).toBe(0);
  });

  it('answers undefined when the issuer throws, and asks it only once', async () => {
    const brokenIssuer = await startBrokenIssuer();
    try {
      await storeExpiringTokens();
      process.env.IDP_ISSUER = brokenIssuer.issuer;

      expect(await currentAccessToken()).toBeUndefined();
      expect(brokenIssuer.requestCount()).toBe(1);
    } finally {
      await brokenIssuer.stop();
    }
  });
});

describe('concurrent readers', () => {
  it('share one rotation, and a later call after settle rotates again', async () => {
    process.env.LIFE_OPS_REFRESH_SKEW_MS = ALWAYS_ROTATE_SKEW_MS;
    await storeExpiringTokens();

    const readers = await Promise.all(
      Array.from({ length: 10 }, () => currentAccessToken()),
    );
    expect(idp.rotations()).toBe(1);
    expect(new Set(readers).size).toBe(1);

    await currentAccessToken();

    expect(idp.rotations()).toBe(2);
  });
});

describe('LIFE_OPS_REFRESH_SKEW_MS', () => {
  it('disables the window at 0, so even an expired token is handed over as stored', async () => {
    process.env.LIFE_OPS_REFRESH_SKEW_MS = '0';
    await storeTokens({ accessToken: sampleApiToken, refreshToken: 'stub.refresh.token', expiresAt: Date.now() - ONE_HOUR_MS });

    expect(await currentAccessToken()).toBe(sampleApiToken);
    expect(idp.rotations()).toBe(0);
  });

  it('falls back to 60 s when the value is unparseable', async () => {
    process.env.LIFE_OPS_REFRESH_SKEW_MS = 'soon';
    await storeExpiringTokens();

    expect(await currentAccessToken()).not.toBe(sampleApiToken);
    expect(idp.rotations()).toBe(1);
  });
});

describe('the adapters', () => {
  it('has the MCP server rotate through the provider', async () => {
    await storeExpiringTokens();

    await askToolCall();

    expect(idp.rotations()).toBe(1);
    expect(api.requestLog[0]?.headers['authorization']).toBe(
      `Bearer ${(await readTokens())?.accessToken}`,
    );
  });

  it('sends the stale token, and rotates nothing, on an executor wired as cli/run.ts wires it', async () => {
    await storeExpiringTokens();
    const executor = createExecutor({ registry: sampleRegistry, baseUrl: api.baseUrl, readToken });

    await executor.run('list', {});

    expect(idp.rotations()).toBe(0);
    expect(api.requestLog[0]?.headers['authorization']).toBe(`Bearer ${sampleApiToken}`);
  });
});

/**
 * The expiring entry the window cases start from: a real login, so the stub IdP
 * knows the refresh token, then the same pair aged into the window.
 */
async function storeExpiringTokens(): Promise<void> {
  const stored = await login({ issuer: idp.issuer, openBrowser: idp.openBrowser });
  await storeTokens({ ...stored, expiresAt: Date.now() + EXPIRING_SOON_MS });
}

async function askToolCall(): Promise<unknown> {
  const server = createMcpServer({
    registry: sampleRegistry,
    apiBase: api.baseUrl,
    env: process.env,
    stdout: () => {},
    stderr: () => {},
  });
  return await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'sample_list', arguments: {} },
  });
}

/** An issuer whose metadata is not JSON, so discovery throws; it counts what it was asked. */
interface BrokenIssuer {
  issuer: string;
  requestCount: () => number;
  stop: () => Promise<void>;
}

async function startBrokenIssuer(): Promise<BrokenIssuer> {
  let count = 0;
  const server = createServer((_request, response) => {
    count += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('not json');
  });
  const port = await listenOnLoopback(server);
  return { issuer: `http://127.0.0.1:${port}`, requestCount: () => count, stop: () => closeServer(server) };
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function restore(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}
