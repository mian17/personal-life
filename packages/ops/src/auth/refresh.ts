/**
 * Refresh rotation (SPEC.md §3): swaps a stored refresh token for a fresh pair
 * and overwrites the store, so the old token cannot be replayed after a
 * rotation. A missing refresh token — or any IdP rejection — reads as
 * "re-login required"; the caller renders the canonical login hint.
 *
 * IdP discovery happens once per call from `IDP_ISSUER`; the request channel
 * is injectable so the auth suite drives a stub token endpoint.
 */
import { discoverEndpoints, resolveLoginOptions } from './login';
import { readTokens, storeTokens, type StoredTokens } from './token-store';

/** Everything `refresh` needs; issuer/client/resource all resolve like `login`. */
export interface RefreshOptions {
  issuer: string;
  clientId: string;
  resource: string;
  request: (url: string, init?: RequestInit) => Promise<Response>;
}

interface RotationReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const FALLBACK_EXPIRY_S = 3600;

/** The rotation's own budget: a hung IdP reads as "login required" instead of wedging the call. */
const ROTATION_DEADLINE_MS = 30_000;

/** Rotates the stored refresh token; returns the fresh pair, or `undefined` when login is required. */
export async function refresh(partial?: Partial<RefreshOptions>): Promise<StoredTokens | undefined> {
  const options = defaults(partial);
  const held = await readTokens();
  if (held?.refreshToken === undefined) return undefined;
  return rotate(options, held.refreshToken);
}

function defaults(partial?: Partial<RefreshOptions>): RefreshOptions {
  const resolved = resolveLoginOptions(process.env);
  return {
    issuer: partial?.issuer ?? resolved.issuer,
    clientId: partial?.clientId ?? resolved.clientId,
    resource: partial?.resource ?? resolved.resource,
    request: partial?.request ?? boundedRequest,
  };
}

/** The default channel: every IdP request carries the deadline signal, so a hang aborts. */
function boundedRequest(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ROTATION_DEADLINE_MS) });
}

async function rotate(options: RefreshOptions, refreshToken: string): Promise<StoredTokens | undefined> {
  const endpoints = await discoverEndpoints(options);
  const reply = await requestRotation(endpoints.tokenEndpoint, options, refreshToken);
  if (reply === undefined) return undefined;
  const rotated: StoredTokens = {
    accessToken: reply.access_token as string,
    refreshToken: reply.refresh_token,
    expiresAt: Date.now() + expiryMs(reply.expires_in),
  };
  await storeTokens(rotated);
  return rotated;
}

async function requestRotation(
  tokenEndpoint: string,
  options: RefreshOptions,
  refreshToken: string,
): Promise<RotationReply | undefined> {
  const response = await options.request(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: rotationForm(options, refreshToken),
  });
  if (!response.ok) return undefined;
  const reply = (await response.json()) as RotationReply;
  return isRotationReply(reply) ? reply : undefined;
}

function rotationForm(options: Pick<RefreshOptions, 'clientId' | 'resource'>, refreshToken: string): string {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('client_id', options.clientId);
  form.set('resource', options.resource);
  form.set('refresh_token', refreshToken);
  return form.toString();
}

function isRotationReply(reply: RotationReply): reply is RotationReply & { access_token: string } {
  return typeof reply.access_token === 'string' && reply.access_token !== '';
}

function expiryMs(expiresIn: number | undefined): number {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : FALLBACK_EXPIRY_S;
  return seconds * 1000;
}
