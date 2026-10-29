/**
 * The recording stub service API (SPEC.md §7): a `node:http` server
 * implementing the kernel contract (docs/specs/SPEC-service-kernel.md) — Bearer
 * auth, owner-scoped rows, byte-identical 401/404, 409 on a stale
 * `expectedVersion`, cursor pagination — while recording every received
 * request so the parity suites can compare what each adapter sent.
 *
 * It records requests only: it stores the fields the caller supplied, performs
 * no encryption, and holds no plaintext derived from a real service.
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
 * A stub a suite can also interrogate: `storedRows` is every row it holds, trash
 * included, so one case can compare the state two calls left behind. Kept beside
 * `StubApi` because a suite may hand-build a plain service without rows.
 */
export interface RecordingStubApi extends StubApi {
  storedRows: () => readonly SampleRow[];
}

/**
 * One stored row: the identity the stub owns (id, owner, version) plus whatever
 * fields the caller supplied, so one stub serves the sample registry and the
 * notes registry without restating either service's column set. `ownerSub` never
 * leaves the stub: only the owning `sub` reads the row, and foreign and missing
 * ids answer byte-identically.
 */
export interface SampleRow {
  id: string;
  ownerSub: string;
  version: number;
  /** Set while the row sits in the trash; the active listing and reads skip a trashed row. */
  deletedAt?: string | null;
  [fieldName: string]: unknown;
}

/** What a suite decides about the stub beyond the rows it seeds. */
export interface StubApiOptions {
  /** The `sub` the presented Bearer token carries; every other owner reads foreign. */
  ownerSubject: string;
  rows?: SampleRow[];
  /** The collection's path; `samples` unless the registry under test declares another base path. */
  collectionPath?: string;
  /**
   * What `DELETE` does to a row. `remove` drops it (the sample registry's shape);
   * `trash` keeps it with `deletedAt` set, so `POST .../restore` can return it —
   * the shape `note-service` serves.
   */
  deletePolicy?: 'remove' | 'trash';
}

interface StubState {
  ownerSubject: string;
  rows: SampleRow[];
  log: RecordedRequest[];
  collectionPath: string;
  deletePolicy: 'remove' | 'trash';
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
const defaultCollectionPath = 'samples';
const restoreSegment = 'restore';
const defaultPageLimit = 20;
const ownerField = 'ownerSub';

/** The fields the stub itself owns; a caller's payload never overwrites them. */
const reservedFields: ReadonlySet<string> = new Set([
  'id',
  'version',
  ownerField,
  'expectedVersion',
  'deletedAt',
]);

const unauthorizedBody = '{"message":"Unauthorized"}';
const missingBody = '{"message":"Sample not found"}';
const conflictBody = '{"message":"Sample was modified"}';

/** Start the stub on an OS-chosen loopback port. */
export async function startStubApi(options: StubApiOptions): Promise<RecordingStubApi> {
  const state: StubState = {
    ownerSubject: options.ownerSubject,
    rows: options.rows ?? [],
    log: [],
    collectionPath: options.collectionPath ?? defaultCollectionPath,
    deletePolicy: options.deletePolicy ?? 'remove',
  };
  const server = createServer((request, response) => {
    void answer({ request, response }, state);
  });
  const port = await listenOnLoopback(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requestLog: state.log,
    storedRows: () => state.rows,
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
  const addressSegments = segmentsAfterCollection(call.state.collectionPath, call.recorded.path);
  if (addressSegments === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  if (addressSegments.length === 0) {
    routeCollection(call, response);
    return;
  }
  const id = addressSegments[0];
  if (addressSegments.length === 1) {
    routeRow({ call, id }, response);
    return;
  }
  if (addressSegments.length === 2 && addressSegments[1] === restoreSegment) {
    restoreRow({ call, id }, response);
    return;
  }
  sendBody(response, 404, missingBody);
}

/** The path segments after the collection path; `undefined` when the request is elsewhere. */
function segmentsAfterCollection(
  collectionPath: string,
  requestPath: string,
): string[] | undefined {
  const collection = pathSegments(collectionPath);
  const requested = pathSegments(requestPath);
  const withinCollection = collection.every((segment, index) => requested[index] === segment);
  return withinCollection ? requested.slice(collection.length) : undefined;
}

function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
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
    deleteRow(target, response);
    return;
  }
  sendBody(response, 404, missingBody);
}

function createRow(call: StubCall, response: ServerResponse): void {
  const row: SampleRow = {
    ...storedFields(bodyObject(call.recorded.body)),
    id: randomUUID(),
    version: 1,
    ownerSub: call.state.ownerSubject,
  };
  call.state.rows.push(row);
  sendJson(response, 201, publicRow(row));
}

function readRow(target: RowTarget, response: ServerResponse): void {
  const row = activeRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  sendJson(response, 200, publicRow(row));
}

function listRows(call: StubCall, response: ServerResponse): void {
  const rows = activeRows(call.state).sort(compareById);
  const start = startAfter(rows, call.recorded.query['cursor']);
  const page = rows.slice(start, start + pageLimit(call.recorded.query['limit']));
  sendJson(response, 200, listingPage(rows, page, start));
}

function patchRow(target: RowTarget, response: ServerResponse): void {
  const row = activeRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  const supplied = bodyObject(target.call.recorded.body);
  if (isStaleVersion(row, supplied)) {
    sendBody(response, 409, conflictBody);
    return;
  }
  Object.assign(row, storedFields(supplied));
  row.version += 1;
  sendJson(response, 200, publicRow(row));
}

function deleteRow(target: RowTarget, response: ServerResponse): void {
  const row = activeRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  if (target.call.state.deletePolicy === 'trash') {
    trashRow(row);
    sendJson(response, 200, { ok: true });
    return;
  }
  removeRow(target.call.state, row);
  sendJson(response, 200, publicRow(row));
}

function restoreRow(target: RowTarget, response: ServerResponse): void {
  const row = trashedRow(target.call, target.id);
  if (row === undefined) {
    sendBody(response, 404, missingBody);
    return;
  }
  row.deletedAt = null;
  sendJson(response, 200, publicRow(row));
}

/** Trashing keeps the row so `restore` can address it, exactly as `note-service` does. */
function trashRow(row: SampleRow): void {
  row.deletedAt = new Date().toISOString();
}

function removeRow(state: StubState, row: SampleRow): void {
  state.rows = state.rows.filter((candidate) => candidate !== row);
}

function carriesOwnerToken(recorded: RecordedRequest): boolean {
  const header = recorded.headers['authorization'] ?? '';
  if (!header.startsWith(tokenScheme)) return false;
  const token = header.slice(tokenScheme.length);
  return token === sampleApiToken || token.startsWith(rotatedTokenPrefix);
}

function activeRows(state: StubState): SampleRow[] {
  return ownedRows(state).filter((row) => !isTrashed(row));
}

function activeRow(call: StubCall, id: string): SampleRow | undefined {
  return activeRows(call.state).find((row) => row.id === id);
}

function trashedRow(call: StubCall, id: string): SampleRow | undefined {
  return ownedRows(call.state).find((row) => row.id === id && isTrashed(row));
}

function ownedRows(state: StubState): SampleRow[] {
  return state.rows.filter((row) => row[ownerField] === state.ownerSubject);
}

function isTrashed(row: SampleRow): boolean {
  return row.deletedAt !== undefined && row.deletedAt !== null;
}

/** The caller's own fields, minus the ones the stub owns; the row is what the service stored. */
function storedFields(supplied: Record<string, unknown> | undefined): Record<string, unknown> {
  if (supplied === undefined) return {};
  return Object.fromEntries(
    Object.entries(supplied).filter(([fieldName]) => !reservedFields.has(fieldName)),
  );
}

/** The row as the service answers it: the owner stays inside the stub. */
function publicRow(row: SampleRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([fieldName]) => fieldName !== ownerField),
  );
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
  const parsed = limit === undefined ? Number.NaN : Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) return defaultPageLimit;
  return parsed;
}

function isStaleVersion(row: SampleRow, supplied: Record<string, unknown> | undefined): boolean {
  const seen = supplied?.['expectedVersion'];
  return typeof seen === 'number' && seen !== row.version;
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
