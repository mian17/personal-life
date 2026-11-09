/**
 * `npm run ops -- login` (SPEC.md §3): OIDC authorization code + PKCE against the
 * existing IdP, audience `life-api` (SPEC-service-kernel token model), client
 * `LIFE_OPS_CLIENT_ID` (default `dev` — a dedicated CLI registration would
 * touch `apps/idp`, which is out of scope). The browser lands back on a
 * one-shot loopback listener; tokens flow stdout-free into the store (`./token-store`).
 *
 * Never logs or prints tokens. Any failure leaves the previous store untouched.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { storeTokens, type StoredTokens } from './token-store.js';

/** Everything `login` needs from the environment; the IdP stays a plain-HTTP dev URL. */
export interface LoginOptions {
  /** Defaults to `http://127.0.0.1:3003` (the local IdP). */
  issuer: string;
  /** Defaults to `LIFE_OPS_CLIENT_ID`, else `dev`. */
  clientId: string;
  /** The RFC 8707 resource requested; defaults to the `life-api` audience. */
  resource: string;
  /** Opens the authorization URL; defaults to launching the OS browser. */
  openBrowser: (url: string) => Promise<void> | void;
  /**
   * Receives the authorize and token calls. Defaults to global `fetch` —
   * injected so the auth suite drives a stub IdP instead of the real one.
   */
  request: (url: string, init?: RequestInit) => Promise<Response>;
  /** Prints the fallback URL when the browser cannot open; defaults to stdout. */
  announceUrl: (url: string) => void;
}

interface PendingLogin {
  state: string;
  verifier: string;
}

interface TokenReply {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface IdpEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

const FALLBACK_EXPIRY_S = 3600;
/**
 * The one loopback callback the seeded `dev` client registers
 * (`apps/idp/src/oidc/clients.ts` `DEV_REDIRECT_URIS`): `http://127.0.0.1:8080/cb`.
 * Both parts are fixed — a random port or a different path is rejected by the
 * IdP as `invalid_redirect_uri` once the browser arrives at `/auth`.
 */
const CALLBACK_PORT = 8080;
const CALLBACK_PATH = '/cb';

/** Runs the full dance and returns what landed in the store. */
export async function login(partial?: Partial<LoginOptions>): Promise<StoredTokens> {
  const options = defaults(partial);
  const endpoints = await discoverEndpoints(options);
  const tokens = await authorizeWithLoopback(endpoints, options);
  await storeTokens(tokens);
  return tokens;
}

export function resolveLoginOptions(
  env: NodeJS.ProcessEnv = process.env,
): Pick<LoginOptions, 'issuer' | 'clientId' | 'resource'> {
  return {
    issuer: env.IDP_ISSUER?.trim() || 'http://127.0.0.1:3003',
    clientId: env.LIFE_OPS_CLIENT_ID?.trim() || 'dev',
    resource: env.LIFE_OPS_RESOURCE?.trim() || 'life-api',
  };
}

function defaults(partial?: Partial<LoginOptions>): LoginOptions {
  const resolved = resolveLoginOptions(process.env);
  return {
    issuer: partial?.issuer ?? resolved.issuer,
    clientId: partial?.clientId ?? resolved.clientId,
    resource: partial?.resource ?? resolved.resource,
    openBrowser: partial?.openBrowser ?? openBrowser,
    request: partial?.request ?? ((url, init) => fetch(url, init)),
    announceUrl: partial?.announceUrl ?? defaultAnnounce,
  };
}

/** Discovers `authorization_endpoint` and `token_endpoint` from the issuer. */
export async function discoverEndpoints(
  options: Pick<LoginOptions, 'issuer' | 'request'>,
): Promise<IdpEndpoints> {
  const metadata = (await (
    await options.request(issuerMetadataUrl(options.issuer))
  ).json()) as Record<string, unknown>;
  const authorizationEndpoint = metadata['authorization_endpoint'];
  const tokenEndpoint = metadata['token_endpoint'];
  if (typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') {
    throw new TypeError(`login failed: issuer ${options.issuer} has no OIDC token endpoints`);
  }
  return { authorizationEndpoint, tokenEndpoint };
}

function issuerMetadataUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
}

async function authorizeWithLoopback(
  endpoints: IdpEndpoints,
  options: LoginOptions,
): Promise<StoredTokens> {
  const listener = await listenOnLoopback();
  try {
    return await authorizeThrough(endpoints, options, listener);
  } finally {
    listener.server.close();
  }
}

async function authorizeThrough(
  endpoints: IdpEndpoints,
  options: LoginOptions,
  listener: LoopbackListener,
): Promise<StoredTokens> {
  const pending = beginLogin();
  const authorizationUrl = authorizationUrlFor(endpoints, options, listener.port, pending);
  await openAuthorizationUrl(options, authorizationUrl);
  const callback = await listener.waitForCallback();
  rejectForeignState(callback.state, pending.state);
  return redeemCode(endpoints, options, listener.port, pending.verifier, callback.code);
}

function beginLogin(): PendingLogin {
  return { state: randomToken(), verifier: createCodeVerifier() };
}

function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function randomToken(): string {
  return randomBytes(16).toString('base64url');
}

function authorizationUrlFor(
  endpoints: IdpEndpoints,
  options: LoginOptions,
  port: number,
  pending: PendingLogin,
): string {
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', redirectUriFor(port));
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('resource', options.resource);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('code_challenge', challengeFor(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

async function openAuthorizationUrl(
  options: LoginOptions,
  authorizationUrl: string,
): Promise<void> {
  try {
    await options.openBrowser(authorizationUrl);
  } catch {
    options.announceUrl(authorizationUrl);
  }
}

function rejectForeignState(state: string | undefined, expected: string): void {
  if (!state || state !== expected)
    throw new Error('login failed: authorization response did not match');
}

async function redeemCode(
  endpoints: IdpEndpoints,
  options: LoginOptions,
  port: number,
  verifier: string,
  code: string,
): Promise<StoredTokens> {
  const reply = (await (
    await options.request(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenForm(options, redirectUriFor(port), verifier, code),
    })
  ).json()) as TokenReply;
  if (typeof reply.access_token !== 'string' || reply.access_token === '') {
    throw new Error('login failed: token endpoint returned no access token');
  }
  return toStoredTokens(reply);
}

function tokenForm(
  options: Pick<LoginOptions, 'clientId' | 'resource'>,
  redirectUri: string,
  verifier: string,
  code: string,
): string {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('client_id', options.clientId);
  form.set('redirect_uri', redirectUri);
  form.set('resource', options.resource);
  form.set('code', code);
  form.set('code_verifier', verifier);
  return form.toString();
}

function toStoredTokens(reply: TokenReply): StoredTokens {
  return {
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt: Date.now() + expiryMs(reply.expires_in),
  };
}

function expiryMs(expiresIn: number | undefined): number {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : FALLBACK_EXPIRY_S;
  return seconds * 1000;
}

interface CallbackQuery {
  code: string;
  state: string | undefined;
}

interface LoopbackListener {
  server: Server;
  port: number;
  waitForCallback: () => Promise<CallbackQuery>;
}

function listenOnLoopback(): Promise<LoopbackListener> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(listenError(error));
    });
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      resolve({ server, port: CALLBACK_PORT, waitForCallback: () => waitForCallback(server) });
    });
  });
}

/**
 * The port is not negotiable: an ephemeral one only moves the failure to the IdP,
 * where it arrives as an opaque `invalid_redirect_uri`. Naming the port here keeps
 * the fix (`free 8080`) inside the error the user reads.
 */
function listenError(error: NodeJS.ErrnoException): Error {
  if (error.code === 'EADDRINUSE') {
    return new Error(
      `login failed: port ${CALLBACK_PORT} is already in use; the dev client only accepts ${redirectUriFor(CALLBACK_PORT)}, so free the port and run login again`,
    );
  }
  return new Error(
    `login failed: cannot listen on 127.0.0.1:${CALLBACK_PORT} (${error.code ?? error.message})`,
  );
}

function waitForCallback(server: Server): Promise<CallbackQuery> {
  return new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const query = queryOf(request.url);
      if (!isCallback(request.url) || !query) {
        respond(response, 404, 'not found');
        return;
      }
      if (!query.code) {
        respond(response, 400, 'login failed, try again');
        reject(new Error('login failed: authorization server returned no code'));
        return;
      }
      respond(response, 200, 'login complete, return to the terminal');
      resolve({ code: query.code, state: query.state });
    });
  });
}

function isCallback(url: string | undefined): boolean {
  return (url ?? '').split('?')[0] === CALLBACK_PATH;
}

function queryOf(url: string | undefined): CallbackQuery | undefined {
  if (url === undefined) return undefined;
  const query = new URL(url, 'http://127.0.0.1');
  const code = query.searchParams.get('code');
  if (!code) return undefined;
  return { code, state: query.searchParams.get('state') ?? undefined };
}

function respond(
  response: { end: (body: string) => void; writeHead: (status: number) => void },
  status: number,
  body: string,
): void {
  response.writeHead(status);
  response.end(`${body}\n`);
}

async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const opener = process.platform === 'darwin' ? 'open' : nonMacOpener();
  await new Promise<void>((resolve, reject) => {
    execFile(opener, [url], (error) => {
      // Rebuilt as an Error: the rejection value must be one, and the opener's
      // message is all the caller needs.
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

/** Windows opens a URL with `start`; every other non-macOS platform uses `xdg-open`. */
function nonMacOpener(): string {
  return process.platform === 'win32' ? 'start' : 'xdg-open';
}

function defaultAnnounce(url: string): void {
  process.stdout.write(`Open this URL to log in:\n${url}\n`);
}
