/**
 * The gateway's stdio-facing JSON-RPC loop (SPEC-mcp-gateway §1 "Server identity", §9.9): it
 * answers the handshake a real MCP client needs (`initialize`, `ping`, the inert
 * `notifications/initialized`), serves the merged `tools/list` table, and replies to every other
 * method — and to a line that is not JSON, or is JSON but not a request — with a JSON-RPC error,
 * so one bad line cannot end the session.
 *
 * `tools/list` is cheap: the table comes from the disk cache `cache.ts` keeps under the config's
 * hash, and only the upstreams holding no cached slice are handshaken — all at once, so the
 * fan-out costs the slowest upstream rather than their sum. An unreachable upstream is reported
 * once on stderr and its tools are left out; the other upstreams are still served. The page is
 * complete and carries no `nextCursor`, because the client's own tool search does the deferring.
 *
 * A slice the cache holds is never re-read, so the only party that can report it stale is its own
 * upstream: an upstream that writes `notifications/tools/list_changed` inside its handshake has
 * just said its table moved, so the slice that handshake returned is served for this answer and
 * then dropped, and the next `tools/list` re-handshakes that one upstream alone (spec §1 "Cache
 * invalidation").
 *
 * `tools/call` is lazy, and costs one spawn: the name's `<configkey>__` prefix picks the one
 * upstream that owns it, that upstream is called with the unprefixed name and the caller's own
 * `arguments`, and its whole result object travels back untouched — an `isError: true` result is
 * the upstream's business, not a gateway error. The child is closed before the reply resolves.
 *
 * A `tools/list` answer that differs from the table this session handed its client before is a
 * mid-session move, and the client hears about it once: `notifications/tools/list_changed`, one
 * framed JSON line with no `id` and no reply. The session's first table is its baseline, so it
 * announces nothing.
 *
 * The composition is `config → upstream → merge → cache`, the order the modules document: this
 * file knows JSON-RPC and nothing about how an upstream is reached.
 */
import {
  answerUntilStdinCloses,
  errorAnswer,
  idOf,
  isRecord,
  readMessage,
} from '@life/shared';
import type { RpcRequest } from '@life/shared';
import { dropToolSlice, readToolSlices, toolCacheFileFor, writeToolSlices } from './cache';
import type { ToolCacheLocation } from './cache';
import { loadGatewayConfig } from './config';
import type { GatewayConfig, UpstreamEntry } from './config';
import { mergeToolTables } from './merge';
import type { ForwardedTool, UpstreamSlice, UpstreamTool } from './merge';
import { UpstreamError, callUpstreamTool, listUpstreamTools } from './upstream';
import type { UpstreamNotices } from './upstream';

/** The `serverInfo` name a client sees; the version is the package's own. */
const SERVER_NAME = 'mcp-gateway';

/** Highest first: the first entry is what an unknown requested version falls back to. */
const PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18'];

/** `serverInfo.version`, pinned to the published package version by its own test. */
const SERVER_VERSION: string = (require('../package.json') as { version: string }).version;

/** The standard JSON-RPC codes; every other code the gateway answers with is gateway-local. */
const PARSE_ERROR_CODE = -32700;
const INVALID_REQUEST_CODE = -32600;
const METHOD_NOT_FOUND_CODE = -32601;
const INVALID_PARAMS_CODE = -32602;
const INTERNAL_ERROR_CODE = -32603;

/** The separator `merge.ts` puts between a config key and an upstream's own tool name. */
const TOOL_NAME_SEPARATOR = '__';

/** Injected writers, so a test drives the loop in-process and stdout framing stays single-writer. */
export interface McpServerOptions {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * One in-process JSON-RPC handler. `message` is what the transport delivered: a raw stdin line,
 * which this server parses, or an already-parsed request, which an in-process caller passes.
 * `null` is the no-answer shape for a notification.
 */
export interface McpServer {
  handle(message: unknown): Promise<unknown>;
}

/** One server instance's memory: the writers it answers through, and the table it last handed out. */
interface GatewaySession {
  readonly options: McpServerOptions;
  lastMergedTable: string | undefined;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const session: GatewaySession = { options, lastMergedTable: undefined };
  return { handle: (message) => answer(message, session) };
}

/** Serve stdin until it closes, answering every JSON-RPC request. */
export async function main(options: McpServerOptions): Promise<number> {
  return await answerLinesUntilStdinCloses({ server: createMcpServer(options), options });
}

/** The stdio entry: the environment's config, the process writers, then the loop. */
async function serveFromEnvironment(): Promise<void> {
  process.exitCode = await main({
    env: process.env,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}

interface ServerLoop {
  readonly server: McpServer;
  readonly options: McpServerOptions;
}

/** This server's line loop: the shared reader, told how this server renders an escaped failure. */
function answerLinesUntilStdinCloses(loop: ServerLoop): Promise<number> {
  return answerUntilStdinCloses({
    server: loop.server,
    stdout: loop.options.stdout,
    stderr: loop.options.stderr,
    renderFailure: reasonFor,
  });
}

async function answer(message: unknown, session: GatewaySession): Promise<unknown> {
  const read = readMessage(message);
  if (read.kind === 'unparseable') return unparseableLineAnswer(session.options.stderr);
  if (read.kind === 'notARequest') return notARequestAnswer();
  return await answerRequest(read.request, session);
}

/** A bad line gets both answers: `-32700` on stdout and a diagnostic on stderr. */
function unparseableLineAnswer(stderr: (line: string) => void): unknown {
  const diagnostic = 'parse error: incoming line is not valid JSON';
  stderr(diagnostic);
  return errorAnswer({ id: null, code: PARSE_ERROR_CODE, message: diagnostic });
}

function notARequestAnswer(): unknown {
  return errorAnswer({
    id: null,
    code: INVALID_REQUEST_CODE,
    message: 'invalid request: not a JSON-RPC request object',
  });
}

async function answerRequest(request: RpcRequest, session: GatewaySession): Promise<unknown> {
  if (request.id === undefined) return null; // a notification gets no answer
  if (request.method === 'initialize') return initializeAnswer(request);
  if (request.method === 'ping') return pingAnswer(request);
  if (request.method === 'tools/list') return await listAnswer(request, session);
  if (request.method === 'tools/call') return await callAnswer(request, session);
  return methodNotFoundAnswer(request);
}

function initializeAnswer(request: RpcRequest): unknown {
  return resultAnswer(request, {
    protocolVersion: negotiateVersion(requestedVersion(request)),
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  });
}

/** Echo the requested version when we speak it; otherwise name the highest we speak. */
function negotiateVersion(requested: string | undefined): string {
  const highest = PROTOCOL_VERSIONS[0] as string;
  if (requested !== undefined && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return highest;
}

function pingAnswer(request: RpcRequest): unknown {
  return resultAnswer(request, {});
}

function methodNotFoundAnswer(request: RpcRequest): unknown {
  return errorAnswer({
    id: idOf(request),
    code: METHOD_NOT_FOUND_CODE,
    message: `method not supported: ${request.method}`,
  });
}

/** The merged table, or the typed failure that stopped it — a config or merge failure is a reply. */
async function listAnswer(request: RpcRequest, session: GatewaySession): Promise<unknown> {
  try {
    const tools = await mergedTools(session);
    announceTableChange(session, tools);
    return resultAnswer(request, { tools });
  } catch (error) {
    return failureAnswer(request, error);
  }
}

/** The one line a client's tool table moving mid-session produces: no `id`, so no reply is owed. */
const LIST_CHANGED_NOTIFICATION = JSON.stringify({
  jsonrpc: '2.0',
  method: 'notifications/tools/list_changed',
});

/** Tell the client its table moved, once per change, as one framed JSON line. */
function announceTableChange(session: GatewaySession, tools: readonly ForwardedTool[]): void {
  const table = tableSignature(tools);
  const didTableMove = session.lastMergedTable !== undefined && session.lastMergedTable !== table;
  session.lastMergedTable = table;
  if (didTableMove) session.options.stdout(LIST_CHANGED_NOTIFICATION);
}

/** A table's whole content, order included; merge order is deterministic, so this compares stably. */
function tableSignature(tools: readonly ForwardedTool[]): string {
  return JSON.stringify(tools);
}

/** One upstream does the work; its result object is the answer, `isError` and all. */
async function callAnswer(request: RpcRequest, session: GatewaySession): Promise<unknown> {
  const requestedName = toolNameOf(request);
  if (requestedName === undefined) {
    return invalidParamsAnswer(request, 'tools/call needs a params.name string');
  }

  try {
    const config = loadGatewayConfig(session.options.env);
    const lookup = routeForTool(requestedName, config);
    if (lookup.kind === 'unknownTool') return invalidParamsAnswer(request, lookup.reason);

    const result = await callUpstreamTool(
      lookup.route.entry,
      lookup.route.toolName,
      toolArgumentsOf(request),
    );
    return resultAnswer(request, result);
  } catch (error) {
    return failureAnswer(request, error);
  }
}

/** The complete table: the cached slices as they stand, plus whatever this call re-handshook. */
async function mergedTools(session: GatewaySession): Promise<ForwardedTool[]> {
  const config = loadGatewayConfig(session.options.env);
  const location = cacheLocationFor(config.path, config.hash);
  const cachedSlices = readToolSlices(location);
  const refreshedSlices = await refreshMissingSlices(config.entries, {
    location,
    cachedSlices,
    reportUpstreamDown: session.options.stderr,
  });
  const slices = slicesInDeclaredOrder(config.entries, [...cachedSlices, ...refreshedSlices]);
  return mergeToolTables(slices);
}

function cacheLocationFor(configPath: string, configHash: string): ToolCacheLocation {
  return { path: toolCacheFileFor(configPath), configHash };
}

/** What a refresh needs: where the cache lives, what it already holds, and where a down report goes. */
interface RefreshRequest {
  readonly location: ToolCacheLocation;
  readonly cachedSlices: readonly UpstreamSlice[];
  readonly reportUpstreamDown: (line: string) => void;
}

/**
 * Handshake every upstream that holds no cached slice, all at once. What comes back is written
 * as per-upstream slices, so a down upstream keeps its absence instead of persisting an empty
 * table, and a later success fills its key in without disturbing the others. An upstream that
 * announced a change while we read it is served now and forgotten afterwards, so its slice never
 * outlives the announcement.
 */
async function refreshMissingSlices(
  entries: readonly UpstreamEntry[],
  request: RefreshRequest,
): Promise<UpstreamSlice[]> {
  const missing = entries.filter((entry) => !holdsSlice(request.cachedSlices, entry.configKey));
  const handshaken = await Promise.all(missing.map((entry) => sliceFromUpstream(entry, request)));
  const answered = handshaken.filter(isAnsweredSlice);
  if (answered.length === 0) return [];

  writeToolSlices(request.location, answered.map((slice) => slice.slice));
  forgetAnnouncedChanges(request.location, answered);
  return answered.map((slice) => slice.slice);
}

/** One upstream's fresh slice, and whether that upstream claimed its table had moved. */
interface AnsweredSlice {
  readonly slice: UpstreamSlice;
  readonly announcedTableChange: boolean;
}

/**
 * An upstream that announced a change keeps no cached slice: its table moved while we were reading
 * it, so the next `tools/list` re-handshakes that upstream rather than trust this read as the
 * table's settled state. The other upstreams' slices are left exactly as they were.
 */
function forgetAnnouncedChanges(
  location: ToolCacheLocation,
  answered: readonly AnsweredSlice[],
): void {
  for (const upstream of answered.filter((slice) => slice.announcedTableChange)) {
    dropToolSlice(location, upstream.slice.configKey);
  }
}

/** One upstream's slice, or nothing when it is unreachable — reported once, on stderr. */
async function sliceFromUpstream(
  entry: UpstreamEntry,
  request: RefreshRequest,
): Promise<AnsweredSlice | undefined> {
  const notices: UpstreamNotices = { toolTableChanged: false };
  try {
    const tools = namedTools(await listUpstreamTools(entry, notices), entry);
    return {
      slice: { configKey: entry.configKey, tools },
      announcedTableChange: notices.toolTableChanged,
    };
  } catch (error) {
    request.reportUpstreamDown(reasonFor(error));
    return undefined;
  }
}

/** The upstream's tools, once every one of them carries the name the merge rewrites. */
function namedTools(tools: unknown[], entry: UpstreamEntry): UpstreamTool[] {
  const unnamed = tools.find((tool) => !isRecord(tool) || typeof tool.name !== 'string');
  if (unnamed === undefined) return tools as UpstreamTool[];
  throw new UpstreamError(entry, 'answered tools/list with a tool that has no name');
}

function holdsSlice(slices: readonly UpstreamSlice[], configKey: string): boolean {
  return slices.some((slice) => slice.configKey === configKey);
}

function isAnsweredSlice(slice: AnsweredSlice | undefined): slice is AnsweredSlice {
  return slice !== undefined;
}

/** Config declaration order decides the table's order, whatever order the slices arrived in. */
function slicesInDeclaredOrder(
  entries: readonly UpstreamEntry[],
  slices: readonly UpstreamSlice[],
): UpstreamSlice[] {
  const byConfigKey = new Map(slices.map((slice) => [slice.configKey, slice]));
  return entries.flatMap((entry) => {
    const slice = byConfigKey.get(entry.configKey);
    return slice === undefined ? [] : [slice];
  });
}

/** The upstream owning a forwarded name, and the tool name that upstream knows it by. */
interface ToolRoute {
  readonly entry: UpstreamEntry;
  readonly toolName: string;
}

/** A forwarded name that resolves to one upstream, or why it resolves to none. */
type RouteLookup =
  | { kind: 'route'; route: ToolRoute }
  | { kind: 'unknownTool'; reason: string };

function routeForTool(name: string, config: GatewayConfig): RouteLookup {
  const entry = upstreamForTool(name, config.entries);
  if (entry === undefined) {
    return { kind: 'unknownTool', reason: `tool "${name}" carries no declared config key prefix` };
  }

  const candidate: ToolRoute = {
    entry,
    toolName: name.slice(entry.configKey.length + TOOL_NAME_SEPARATOR.length),
  };
  if (!publishesTool(config, candidate)) {
    return { kind: 'unknownTool', reason: `tool "${name}" is not in the merged tool table` };
  }
  return { kind: 'route', route: candidate };
}

/**
 * Longest prefix first, because a config key may itself contain the separator: with keys `alpha`
 * and `alpha__beta`, only the longer match reads `alpha__beta__tool` the way it was built.
 */
function upstreamForTool(
  name: string,
  entries: readonly UpstreamEntry[],
): UpstreamEntry | undefined {
  const declared = entries.filter((entry) => name.startsWith(prefixedName(entry.configKey)));
  // `declared` is this call's own array, so sorting it in place stays invisible to the caller.
  declared.sort((left, right) => right.configKey.length - left.configKey.length);
  return declared[0];
}

function prefixedName(configKey: string): string {
  return `${configKey}${TOOL_NAME_SEPARATOR}`;
}

/**
 * Whether the upstream's cached table admits the name. An upstream with no cached slice is called
 * instead of rejected: its table is only unknown here, not empty, and a handshake to find out
 * would double the cost of every call.
 */
function publishesTool(config: GatewayConfig, route: ToolRoute): boolean {
  const slice = readToolSlices(cacheLocationFor(config.path, config.hash)).find(
    (held) => held.configKey === route.entry.configKey,
  );
  if (slice === undefined) return true;
  return slice.tools.some((tool) => tool.name === route.toolName);
}

function toolNameOf(request: RpcRequest): string | undefined {
  const name = paramsOf(request)?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The caller's own `arguments`, passed on byte-identical — not a copy, not a default. */
function toolArgumentsOf(request: RpcRequest): unknown {
  return paramsOf(request)?.arguments;
}

function invalidParamsAnswer(request: RpcRequest, message: string): unknown {
  return errorAnswer({ id: idOf(request), code: INVALID_PARAMS_CODE, message });
}

/** A typed failure's own gateway-local code, or the JSON-RPC internal-error default. */
function failureCodeOf(error: unknown): number {
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === 'number' ? code : INTERNAL_ERROR_CODE;
}

function failureAnswer(request: RpcRequest, error: unknown): unknown {
  return errorAnswer({ id: idOf(request), code: failureCodeOf(error), message: reasonFor(error) });
}

function resultAnswer(request: RpcRequest, result: unknown): unknown {
  return { jsonrpc: '2.0', id: idOf(request), result };
}

function requestedVersion(request: RpcRequest): string | undefined {
  const version = paramsOf(request)?.protocolVersion;
  return typeof version === 'string' ? version : undefined;
}

/** The `params` object of a request; anything else reads as absent. */
function paramsOf(request: RpcRequest): Record<string, unknown> | undefined {
  return isRecord(request.params) ? request.params : undefined;
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  void serveFromEnvironment();
}
