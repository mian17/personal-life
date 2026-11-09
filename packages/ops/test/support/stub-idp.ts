/**
 * The stub IdP (SPEC.md §7): a `node:http` authorization server covering the
 * three endpoints the auth flows touch — OIDC discovery, the authorization-code
 * exchange with PKCE, and refresh-token rotation. The auth suite drives
 * `login`/`refresh` against it, so no test ever contacts the real IdP.
 *
 * It mints the same opaque Bearer tokens the stub API accepts, which is what
 * lets the CLI and MCP parity runs share one authenticated session. It never
 * prints a token.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { sampleApiToken } from './stub-api.js';

/** A running stub IdP: discovery issuer, the browser stand-in, rotation count, shutdown. */
export interface StubIdp {
  issuer: string;
  /** Injected as `LoginOptions.openBrowser`: follows the authorize redirect to the loopback. */
  openBrowser: (authorizationUrl: string) => Promise<void>;
  /** How many refresh rotations have happened; the auth suite asserts the store changed. */
  rotations: () => number;
  /** Every authorization the browser stand-in completed, in arrival order. */
  grants: () => readonly StubGrant[];
  stop: () => Promise<void>;
}

/**
 * What one authorization asked for: the client, the RFC 8707 resource it named,
 * and the audience that resource maps to, which is what the minted token carries.
 */
export interface StubGrant {
  clientId: string;
  resource: string;
  audience: string;
}

interface StubIdpState {
  authorizations: Map<string, string>;
  refreshTokens: Set<string>;
  rotationCount: number;
  grants: StubGrant[];
}

interface StubIdpOptions {
  /** Overrides the listener port; tests pass `0` (the default) for an OS-chosen one. */
  port?: number;
}

const defaultExpirySeconds = 3600;
const rotatedTokenPrefix = `${sampleApiToken}.rotated.`;

/** Start the stub on a loopback port; `stub.openBrowser` completes a login against it. */
export async function startStubIdp(options: StubIdpOptions = {}): Promise<StubIdp> {
  const state: StubIdpState = {
    authorizations: new Map(),
    refreshTokens: new Set(),
    rotationCount: 0,
    grants: [],
  };
  const server = createServer((request, response) => {
    void answer(request, response, state);
  });
  const port = await listenOnLoopback(server, options.port ?? 0);
  const issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    openBrowser: (authorizationUrl) => followAuthorization(authorizationUrl),
    rotations: () => state.rotationCount,
    grants: () => state.grants,
    stop: () => closeServer(server),
  };
}

function listenOnLoopback(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('stub IdP has no loopback port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function followAuthorization(authorizationUrl: string): Promise<void> {
  const callback = await authorizationRedirect(authorizationUrl);
  scheduleCallback(callback);
}

async function authorizationRedirect(authorizationUrl: string): Promise<string> {
  const response = await fetch(authorizationUrl, { redirect: 'manual' });
  const location = response.headers.get('location');
  await response.arrayBuffer();
  if (response.status !== 302 || location === null) {
    throw new Error(`stub IdP refused the authorization request (${response.status})`);
  }
  return location;
}

function scheduleCallback(callback: string): void {
  setImmediate(() => {
    void fetch(callback).then(
      () => undefined,
      () => undefined,
    );
  });
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  state: StubIdpState,
): Promise<void> {
  const path = pathOf(request);
  if (path === '/.well-known/openid-configuration' && request.method === 'GET') {
    sendMetadata(request, response);
    return;
  }
  if (path === '/authorize' && request.method === 'GET') {
    authorize(request, response, state);
    return;
  }
  if (path === '/token' && request.method === 'POST') {
    await exchange(await readBody(request), response, state);
    return;
  }
  sendJson(response, 404, { error: 'not_found' });
}

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
}

function sendMetadata(request: IncomingMessage, response: ServerResponse): void {
  const base = `http://${request.headers.host ?? '127.0.0.1'}`;
  sendJson(response, 200, {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  });
}

function authorize(request: IncomingMessage, response: ServerResponse, state: StubIdpState): void {
  const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
  const redirectUri = query.get('redirect_uri');
  const challenge = query.get('code_challenge');
  const stateParam = query.get('state');
  if (redirectUri === null || challenge === null || stateParam === null) {
    sendJson(response, 400, { error: 'invalid_request' });
    return;
  }
  if (!redirectUri.startsWith('http://127.0.0.1:')) {
    sendJson(response, 400, { error: 'invalid_redirect_uri' });
    return;
  }
  const code = randomUUID();
  state.authorizations.set(code, challenge);
  state.grants.push(grantOf(query));
  sendRedirect(response, callbackUrl(redirectUri, code, stateParam));
}

/** The authorization as this stub reads it: which client asked for which resource. */
function grantOf(query: URLSearchParams): StubGrant {
  const resource = query.get('resource') ?? '';
  return {
    clientId: query.get('client_id') ?? '',
    resource,
    audience: audienceFor(resource),
  };
}

/**
 * The IdP's `OIDC_AUDIENCE_MAP` reading (`apps/idp/src/oidc/access-token.policy.ts`,
 * `audienceFor`): comma-separated `resource=audience` pairs, an unmapped resource
 * contributing its hostname. Restated here, not imported, so no test reaches into
 * `apps/`; a drift shows up as the wrong `aud` on the recorded grant.
 */
function audienceFor(resource: string): string {
  const mapped = audienceMap().get(resource.trim());
  if (mapped !== undefined) return mapped;
  try {
    return new URL(resource).hostname || resource;
  } catch {
    return resource;
  }
}

function audienceMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (process.env.OIDC_AUDIENCE_MAP ?? '').split(',')) {
    const equals = entry.indexOf('=');
    if (equals === -1) continue;
    const resource = entry.slice(0, equals).trim();
    const audience = entry.slice(equals + 1).trim();
    if (resource && audience) map.set(resource, audience);
  }
  return map;
}

function callbackUrl(redirectUri: string, code: string, state: string): string {
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);
  return callback.href;
}

async function exchange(
  body: URLSearchParams,
  response: ServerResponse,
  state: StubIdpState,
): Promise<void> {
  const grant = body.get('grant_type');
  if (grant === 'authorization_code') {
    redeemCode(body, response, state);
    return;
  }
  if (grant === 'refresh_token') {
    rotate(body, response, state);
    return;
  }
  sendJson(response, 400, { error: 'unsupported_grant_type' });
}

function redeemCode(body: URLSearchParams, response: ServerResponse, state: StubIdpState): void {
  const code = body.get('code');
  const verifier = body.get('code_verifier');
  const expectedChallenge = code === null ? undefined : state.authorizations.get(code);
  if (code === null || verifier === null || expectedChallenge === undefined) {
    sendJson(response, 400, { error: 'invalid_grant' });
    return;
  }
  if (challengeFor(verifier) !== expectedChallenge) {
    sendJson(response, 400, { error: 'invalid_grant' });
    return;
  }
  state.authorizations.delete(code);
  sendTokens(response, state);
}

function rotate(body: URLSearchParams, response: ServerResponse, state: StubIdpState): void {
  const presented = body.get('refresh_token');
  if (presented === null || !state.refreshTokens.has(presented)) {
    sendJson(response, 400, { error: 'invalid_grant' });
    return;
  }
  state.refreshTokens.delete(presented);
  state.rotationCount += 1;
  sendTokens(response, state);
}

function sendTokens(response: ServerResponse, state: StubIdpState): void {
  const refreshToken = randomUUID();
  state.refreshTokens.add(refreshToken);
  sendJson(response, 200, {
    access_token: accessTokenFor(state.rotationCount),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: defaultExpirySeconds,
  });
}

/** The stub API accepts the base token and every rotated one (see `stub-api.ts`). */
function accessTokenFor(rotationCount: number): string {
  return rotationCount === 0 ? sampleApiToken : `${rotatedTokenPrefix}${rotationCount}`;
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
  const text = await readText(request);
  return new URLSearchParams(text);
}

function readText(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
