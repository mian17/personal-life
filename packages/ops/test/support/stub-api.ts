/**
 * The recording stub service API (SPEC.md §7): a `node:http` server
 * implementing the kernel contract (docs/specs/SPEC-service-kernel.md) — Bearer
 * auth, owner-scoped rows, byte-identical 401/404, 409 on a stale
 * `expectedVersion`, cursor pagination — while recording every received
 * request so the parity suite can compare what each adapter sent.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * One request the stub received, in wire form: the parity suite asserts two
 * adapters produced equal entries.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/** The address the stub listens on; `stop` closes it (nothing leaks past a test). */
export interface StubApi {
  baseUrl: string;
  requestLog: readonly RecordedRequest[];
  stop: () => Promise<void>;
}

/**
 * One stored sample row. `ownerSub` never leaves the stub: only the owning
 * `sub` reads the row, and foreign and missing ids answer byte-identically.
 */
export interface SampleRow {
  id: string;
  title: string;
  priority?: number;
  archived?: boolean;
  labels?: string[];
  version: number;
  ownerSub: string;
}

interface StubApiOptions {
  /** The `sub` the presented Bearer token carries; every other owner reads foreign. */
  ownerSubject: string;
  rows?: SampleRow[];
}

interface StubState {
  ownerSubject: string;
  rows: SampleRow[];
  log: RecordedRequest[];
}

interface StubExchange {
  request: IncomingMessage;
  response: ServerResponse;
}

interface StubCall {
  recorded: RecordedRequest;
  state: StubState;
}

interface RowTarget {
  call: StubCall;
  id: string;
}

/**
 * The Bearer token the stub accepts (opaque here — the subject mapping lives in
 * `ownerSubject`; the auth suite drives its own IdP and only this claim
 * is checked). Tokens the stub IdP mints on rotation share the same prefix.
 */
export const sampleApiToken = 'stub.access.token';

const rotatedTokenPrefix = `${sampleApiToken}.rotated.`;
const tokenScheme = 'Bearer ';
const samplesPath = 'samples';
const defaultPageLimit = 20;

const unauthorizedBody = '{"message":"Unauthorized"}';
const missingBody = '{"message":"Sample not found"}';
const conflictBody = '{"message":"Sample was modified"}';
const titleRequiredBody = '{"message":"title is required"}';

/** Start the stub on an OS-chosen loopback port. */
export async function startStubApi(options: StubApiOptions): Promise<StubApi> {
  const state: StubState = {
    ownerSubject: options.ownerSubject,
    rows: options.rows ?? [],
    log: [],
  };
  const server = createServer((request, response) => {
    void answer({ request, response }, state);
  });
  const port = await listenOnLoopback(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requestLog: state.log,
    stop: () => closeServer(server),
  };
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('stub API has no loopback port'));
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

async function answer(exchange: StubExchange, state: StubState): Promise<void> {
  const recorded = await readRequest(exchange.request);
  state.log.push(recorded);
  if (!carriesOwnerToken(recorded)) {
    sendBody(exchange.response, 401, unauthorizedBody);
    return;
  }
  route({ recorded, state }, exchange.response);
}

function route(call: StubCall, response: ServerResponse): void {
  const segments = call.recorded.path.split('/').filter((segment) => segment !== '');
  if (segments[0] !== samplesPath) {
    sendBody(response, 404, missingBody);
    return;
  }
  if (segments.length === 1) {
    routeCollection(call, response);
    return;
  }
  if (segments.length === 2 && typeof segments[1] === 'string') {
    routeRow({ call, id: segments[1] }, response);
    return;
  }
  sendBody(response, 404, missingBody);
}

function routeCollection(call: StubCall, response: ServerResponse): void {
  if (call.recorded.method === 'POST') {
    createRow(call, response);
    return;
  }
  if (call.recorded.method === 'GET') {
    listRows(call, response);
    return;
  }
  sendBody(response, 404, missingBody);
}

function routeRow(target: RowTarget, response: ServerResponse): void {
  if (target.call.recorded.method === 'GET') {
    readRow(target, response);
    return;
  }
  if (target.call.recorded.method === 'PATCH') {
    patchRow(target, response);
    return;
  }
  if (target.call.recorded.method === 'DELETE') {
    removeRow(target, response);
    return;
  }
  sendBody(response, 404, missingBody);
}

function createRow(call: StubCall, response: ServerResponse): void {
  const supplied = bodyObject(call.recorded.body);
  if (supplied === undefined || typeof supplied['title'] !== 'string') {
    sendBody(response, 400, titleRequiredBody);
    return;
  }
  const row: SampleRow = {
    id: randomUUID(),
    title: supplied['title'],
    priority: numberField(supplied, 'priority'),
    archived: booleanField(supplied, 'archived'),
    labels: stringListField(supplied, 'labels'),
    version: 1,
    ownerSub: call.state.ownerSubject,
  };
  call.state.rows.push(row);
  sendJson(response, 201, publicRow(row));
}

function readRow(target: RowTarget, response: ServerResponse): void {
  const row = visibleRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  sendJson(response, 200, publicRow(row));
}

function listRows(call: StubCall, response: ServerResponse): void {
  const rows = visibleRows(call.state).sort(compareById);
  const start = startAfter(rows, call.recorded.query['cursor']);
  const page = rows.slice(start, start + pageLimit(call.recorded.query['limit']));
  sendJson(response, 200, listingPage(rows, page, start));
}

function patchRow(target: RowTarget, response: ServerResponse): void {
  const row = visibleRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  const supplied = bodyObject(target.call.recorded.body);
  if (isStaleVersion(row, supplied)) {
    sendBody(response, 409, conflictBody);
    return;
  }
  applyPatch(row, supplied ?? {});
  sendJson(response, 200, publicRow(row));
}

function removeRow(target: RowTarget, response: ServerResponse): void {
  const row = visibleRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  target.call.state.rows = target.call.state.rows.filter((candidate) => candidate !== row);
  sendJson(response, 200, publicRow(row));
}

function carriesOwnerToken(recorded: RecordedRequest): boolean {
  const header = recorded.headers['authorization'] ?? '';
  if (!header.startsWith(tokenScheme)) return false;
  const token = header.slice(tokenScheme.length);
  return token === sampleApiToken || token.startsWith(rotatedTokenPrefix);
}

function visibleRows(state: StubState): SampleRow[] {
  return state.rows.filter((row) => row.ownerSub === state.ownerSubject);
}

function visibleRow(call: StubCall, id: string): SampleRow | undefined {
  return visibleRows(call.state).find((row) => row.id === id);
}

function publicRow(row: SampleRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    archived: row.archived,
    labels: row.labels,
    version: row.version,
  };
}

function listingPage(all: SampleRow[], page: SampleRow[], start: number): Record<string, unknown> {
  const body: Record<string, unknown> = { items: page.map(publicRow) };
  if (start + page.length < all.length) {
    const last = page[page.length - 1];
    if (last !== undefined) body['nextCursor'] = cursorFor(last);
  }
  return body;
}

function cursorFor(row: SampleRow): string {
  return Buffer.from(row.id, 'utf8').toString('base64url');
}

function startAfter(rows: SampleRow[], cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const index = rows.findIndex((row) => row.id === decodeCursor(cursor));
  return index === -1 ? 0 : index + 1;
}

function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function pageLimit(limit: string | undefined): number {
  const parsed = limit === undefined ? NaN : Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) return defaultPageLimit;
  return parsed;
}

function isStaleVersion(row: SampleRow, supplied: Record<string, unknown> | undefined): boolean {
  const seen = supplied?.['expectedVersion'];
  return typeof seen === 'number' && seen !== row.version;
}

function applyPatch(row: SampleRow, supplied: Record<string, unknown>): void {
  if (typeof supplied['title'] === 'string') row.title = supplied['title'];
  const priority = numberField(supplied, 'priority');
  if (priority !== undefined) row.priority = priority;
  const archived = booleanField(supplied, 'archived');
  if (archived !== undefined) row.archived = archived;
  const labels = stringListField(supplied, 'labels');
  if (labels !== undefined) row.labels = labels;
  row.version += 1;
}

function compareById(left: SampleRow, right: SampleRow): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function bodyObject(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}

function numberField(supplied: Record<string, unknown>, name: string): number | undefined {
  const value = supplied[name];
  return typeof value === 'number' ? value : undefined;
}

function booleanField(supplied: Record<string, unknown>, name: string): boolean | undefined {
  const value = supplied[name];
  return typeof value === 'boolean' ? value : undefined;
}

function stringListField(supplied: Record<string, unknown>, name: string): string[] | undefined {
  const value = supplied[name];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return undefined;
  return value as string[];
}

async function readRequest(request: IncomingMessage): Promise<RecordedRequest> {
  const text = await readText(request);
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return {
    method: request.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: headersOf(request),
    body: parseBody(text),
  };
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

function headersOf(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

function parseBody(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  sendBody(response, status, JSON.stringify(body));
}

function sendBody(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body);
}
