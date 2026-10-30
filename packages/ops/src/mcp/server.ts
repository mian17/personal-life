/**
 * The MCP stdio server (SPEC.md §3, §10.2; SPEC-ops-agent-contract §3.1): a
 * hand-rolled JSON-RPC stdio loop that answers the handshake a real MCP client
 * needs (`initialize`, `ping`, the inert `notifications/initialized`), the two
 * tool methods, and nothing else — no SDK, no third method was agreed. A line
 * that is not JSON, or is JSON but not a request, still gets a JSON-RPC error
 * reply, so one bad line cannot end the session. Every call routes through the
 * one shared executor and the one canonical render the CLI uses, so adapter
 * parity is a string comparison, not a convention.
 */
import type { ResourceRegistry } from '../core/types';
import { createExecutor, resolveDeadlineMs } from '../transport/executor';
import type { Executor } from '../transport/executor';
import { currentAccessToken } from '../auth/token-provider';
import { renderFailure, renderOpsResult } from '../cli/render';
import { apiBaseFor, loadService } from '../cli/run';
import type { LoadedModule, ServiceModule } from '../cli/run';
import { everyRegistry, findTool, listTools } from './tools';
import type { RegistryUnion, ToolLocation } from './tools';

const SERVER_NAME = 'life-ops';

/** Highest first: the first entry is what an unknown requested version falls back to. */
const PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18'];

/** `serverInfo.version`, pinned to the published package version by `test/mcp-lifecycle.test.ts`. */
const SERVER_VERSION: string = (require('../../package.json') as { version: string }).version;

/**
 * The stdio-facing server contract: the resources it serves, the loaded modules, the
 * environment, and the injected writers (tests drive stubs).
 */
export interface McpServerOptions {
  /** Every resource the loaded modules register, in load order; a single-service run names one. */
  registry: RegistryUnion;
  /** The modules `LIFE_OPS_SERVICE` loaded, when it named several; the base precedence reads them. */
  modules?: LoadedModule[];
  /** Overrides `LIFE_OPS_API_BASE` when the service module knows its own base. */
  apiBase?: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * One in-process JSON-RPC handler. `message` is what the transport delivered: a
 * raw stdin line, which this server parses, or an already-parsed request, which
 * an in-process caller passes. `null` is the no-answer shape for a notification.
 */
export interface McpServer {
  handle(message: unknown): Promise<unknown>;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const session: Session = { options, service: servedService(options) };
  return { handle: (message) => answer(message, session) };
}

/** Serve the session until stdin closes, answering every JSON-RPC request. */
export async function main(options: McpServerOptions): Promise<number> {
  return await answerRequestsUntilStdinCloses({ server: createMcpServer(options), options });
}

/** The stdio entry: the service modules named by `LIFE_OPS_SERVICE`, then the loop. */
async function serveFromEnvironment(): Promise<void> {
  try {
    const service = await loadService(process.env);
    process.exitCode = await main({
      registry: service.resources ?? service.registry,
      modules: service.modules,
      apiBase: service.apiBase,
      env: process.env,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    process.stderr.write(`${renderFailure(error)}\n`);
    process.exitCode = 1;
  }
}

function answerRequestsUntilStdinCloses(loop: ServerLoop): Promise<number> {
  return new Promise((finish) => {
    let buffered = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffered += chunk;
      for (;;) {
        const lineEnd = buffered.indexOf('\n');
        if (lineEnd === -1) return;
        const line = buffered.slice(0, lineEnd);
        buffered = buffered.slice(lineEnd + 1);
        void respondToLine(loop, line);
      }
    });
    process.stdin.on('end', () => finish(0));
  });
}

async function respondToLine(loop: ServerLoop, line: string): Promise<void> {
  try {
    const response = await loop.server.handle(line);
    if (response !== null) loop.options.stdout(JSON.stringify(response));
  } catch (error) {
    loop.options.stderr(renderFailure(error));
  }
}

async function answer(message: unknown, session: Session): Promise<unknown> {
  const read = readMessage(message);
  if (read.kind === 'unparseable') return unparseableLineAnswer(session);
  if (read.kind === 'notARequest') return notARequestAnswer();
  return answerRequest(read.request, session);
}

/** A bad line gets both answers: `-32700` on stdout and a diagnostic on stderr. */
function unparseableLineAnswer(session: Session): unknown {
  const diagnostic = 'parse error: incoming line is not valid JSON';
  session.options.stderr(diagnostic);
  return errorAnswer({ id: null, code: -32700, message: diagnostic });
}

function notARequestAnswer(): unknown {
  return errorAnswer({
    id: null,
    code: -32600,
    message: 'invalid request: not a JSON-RPC request object',
  });
}

async function answerRequest(request: RpcRequest, session: Session): Promise<unknown> {
  if (request.id === undefined) return null; // a notification gets no answer
  if (request.method === 'initialize') return initializeAnswer(request);
  if (request.method === 'ping') return pingAnswer(request);
  if (request.method === 'tools/list') return listAnswer(request, session.options.registry);
  if (request.method === 'tools/call') return callAnswer(request, session);
  return methodNotSupportedAnswer(request);
}

function initializeAnswer(request: RpcRequest): unknown {
  return {
    jsonrpc: '2.0',
    id: idOf(request),
    result: {
      protocolVersion: negotiateVersion(requestedVersion(request)),
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    },
  };
}

/** Echo the requested version when we speak it; otherwise name the highest we speak. */
function negotiateVersion(requested: string | undefined): string {
  const highest = PROTOCOL_VERSIONS[0] as string;
  if (requested !== undefined && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return highest;
}

function pingAnswer(request: RpcRequest): unknown {
  return { jsonrpc: '2.0', id: idOf(request), result: {} };
}

function listAnswer(request: RpcRequest, registrySet: RegistryUnion): unknown {
  return { jsonrpc: '2.0', id: idOf(request), result: { tools: listTools(registrySet) } };
}

async function callAnswer(request: RpcRequest, session: Session): Promise<unknown> {
  try {
    return callResultAnswer(request, await runTool(request, session));
  } catch (error) {
    return invalidCallAnswer(request, error);
  }
}

/**
 * The call's result object: the canonical text always, `structuredContent` when the
 * body carries structure (an array wrapped as `{ items }`), `isError` when the call
 * failed (and then nothing structured — a failure is not a payload an agent may branch
 * on).
 */
function callResultAnswer(request: RpcRequest, outcome: ToolOutcome): unknown {
  const result: Record<string, unknown> = { content: [{ type: 'text', text: outcome.text }] };
  const structuredBody = structuredBodyOf(outcome);
  if (structuredBody !== undefined) result['structuredContent'] = structuredBody;
  if (outcome.failed) result['isError'] = true;
  return { jsonrpc: '2.0', id: idOf(request), result };
}

/**
 * The body as `structuredContent`, or `undefined` when it is neither an object nor an
 * array. A bare array is wrapped as `{ items }`: MCP types `structuredContent` as a
 * record at the root (`CallToolResultSchema`), and an array there makes a conformant SDK
 * client throw `$ZodError` instead of returning data — the conformance goal of §2
 * assumption 3 and §9 criterion 1. This narrows §3.3's "verbatim" for array bodies only;
 * the object case is the parsed body untouched. `test/sdk-client.test.ts` and
 * `test/mcp-lifecycle.test.ts` both pin the wrapped shape.
 */
function structuredBodyOf(outcome: ToolOutcome): Record<string, unknown> | undefined {
  if (outcome.failed) return undefined;
  if (Array.isArray(outcome.body)) return { items: outcome.body };
  if (outcome.body !== null && typeof outcome.body === 'object') {
    return outcome.body as Record<string, unknown>;
  }
  return undefined;
}

/** A malformed/unknown `tools/call` still gets a JSON-RPC error reply, never silence. */
function invalidCallAnswer(request: RpcRequest, error: unknown): unknown {
  return errorAnswer({ id: idOf(request), code: -32602, message: renderFailure(error) });
}

async function runTool(request: RpcRequest, session: Session): Promise<ToolOutcome> {
  const { registry, operation } = locateTool(request, session.options.registry);
  try {
    const result = await executorFor(session, registry).run(operation.kind, inputOf(request));
    return { text: renderOpsResult(result), body: result.body, failed: false };
  } catch (error) {
    return { text: renderFailure(error), body: undefined, failed: true };
  }
}

/** The registry that owns the named tool, and the op there; a thrown error when none serves it. */
function locateTool(request: RpcRequest, registrySet: RegistryUnion): ToolLocation {
  const name = paramsOf(request)?.['name'];
  if (typeof name !== 'string') throw new Error('tools/call has no tool name string');
  const location = findTool(registrySet, name);
  if (location === undefined) throw new Error(`unknown tool: ${name}`);
  return location;
}

/** The executor one call runs: it dials the owning resource's own base, resolved per call. */
function executorFor(session: Session, registry: ResourceRegistry): Executor {
  return createExecutor({
    registry,
    baseUrl: apiBaseFor({ service: session.service, registry, env: session.options.env }),
    readToken: currentAccessToken,
    deadlineMs: resolveDeadlineMs(session.options.env),
  });
}

/** The service a session serves, in the shape the CLI's base precedence reads. */
function servedService(options: McpServerOptions): ServiceModule {
  const resources = everyRegistry(options.registry);
  return { registry: resources[0], resources, apiBase: options.apiBase, modules: options.modules };
}

function methodNotSupportedAnswer(request: RpcRequest): unknown {
  return errorAnswer({
    id: idOf(request),
    code: -32601,
    message: `method not supported: ${request.method}`,
  });
}

function errorAnswer(failure: RpcFailure): unknown {
  return { jsonrpc: '2.0', id: failure.id, error: { code: failure.code, message: failure.message } };
}

interface Session {
  options: McpServerOptions;
  /** The service the CLI's base precedence reads, built once from the served resources. */
  service: ServiceModule;
}

interface ServerLoop {
  server: McpServer;
  options: McpServerOptions;
}

interface ToolOutcome {
  /** Exactly what the CLI prints for this result — the byte-identical part. */
  text: string;
  /** The service body as the executor parsed it; `undefined` when there was none. */
  body: unknown;
  failed: boolean;
}

/** `id === undefined` is the notification shape; every other field arrives verbatim. */
interface RpcRequest {
  id: string | number | undefined;
  method: string;
  params: unknown;
}

/** A JSON-RPC error reply's varying part; `null` id is what the protocol asks for a bad line. */
interface RpcFailure {
  id: string | number | null;
  code: number;
  message: string;
}

/** What one delivered message turned out to be. */
type MessageRead =
  | { kind: 'request'; request: RpcRequest }
  | { kind: 'notARequest' }
  | { kind: 'unparseable' };

function readMessage(message: unknown): MessageRead {
  if (typeof message !== 'string') return readRequest(message);
  const parsed = parseLine(message);
  return parsed.kind === 'unparseable' ? parsed : readRequest(parsed.value);
}

function parseLine(line: string): { kind: 'parsed'; value: unknown } | { kind: 'unparseable' } {
  try {
    return { kind: 'parsed', value: JSON.parse(line) as unknown };
  } catch {
    return { kind: 'unparseable' };
  }
}

function readRequest(parsed: unknown): MessageRead {
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'notARequest' };
  const record = parsed as Record<string, unknown>;
  if (typeof record['method'] !== 'string') return { kind: 'notARequest' };
  return {
    kind: 'request',
    request: { id: requestId(record), method: record['method'], params: record['params'] },
  };
}

function requestId(record: Record<string, unknown>): string | number | undefined {
  if (typeof record['id'] === 'string' || typeof record['id'] === 'number') return record['id'];
  return undefined;
}

function idOf(request: RpcRequest): string | number | null {
  return request.id ?? null;
}

/** The `arguments` object of the call; an absent one behaves as an empty input. */
function inputOf(request: RpcRequest): Record<string, unknown> {
  const args = paramsOf(request)?.['arguments'];
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function requestedVersion(request: RpcRequest): string | undefined {
  const version = paramsOf(request)?.['protocolVersion'];
  return typeof version === 'string' ? version : undefined;
}

/** The `params` object of a request; anything else reads as absent. */
function paramsOf(request: RpcRequest): Record<string, unknown> | undefined {
  const params = request.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  return params as Record<string, unknown>;
}

if (require.main === module) {
  void serveFromEnvironment();
}