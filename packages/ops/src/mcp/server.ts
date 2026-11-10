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
import { answerUntilStdinCloses, errorAnswer, idOf, readMessage } from '@life/shared';
import type { RpcRequest } from '@life/shared';
import type { OpSpec, ResourceRegistry } from '../core/types.js';
import type { BulkEnvelope } from '../core/bulk.js';
import { isBulkKind, resolveBulkLimit } from '../core/bulk.js';
import { createExecutor, resolveDeadlineMs } from '../transport/executor.js';
import type { Executor } from '../transport/executor.js';
import { currentAccessToken } from '../auth/token-provider.js';
import { renderFailure, renderOpsResult } from '../cli/render.js';
import { apiBaseFor } from '../cli/run.js';
import type { LoadedModule, ServiceModule } from '../cli/run.js';
import { everyRegistry, findTool, listTools } from './tools.js';
import type { RegistryUnion, ToolLocation } from './tools.js';

const SERVER_NAME = 'life-ops';

/** Highest first: the first entry is what an unknown requested version falls back to. */
const PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18'];

/**
 * `serverInfo.version` when a caller names none: a library caller is not the published
 * package, so it does not get to claim a version. The stdio entry (`mcp/entry.ts`) always
 * passes the real one, and `test/sdk-client.test.ts` pins the spawned entry to `package.json`.
 */
const DEVELOPMENT_VERSION = '0.0.0-dev';

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
  /** `serverInfo.version`; the stdio entry passes the published version, a library caller may omit it. */
  serverVersion?: string;
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

/** This server's line loop: the shared reader, told how an escaped failure is rendered here. */
function answerRequestsUntilStdinCloses(loop: ServerLoop): Promise<number> {
  return answerUntilStdinCloses({
    server: loop.server,
    stdout: loop.options.stdout,
    stderr: loop.options.stderr,
    renderFailure,
  });
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
  if (request.method === 'initialize') return initializeAnswer(request, session);
  if (request.method === 'ping') return pingAnswer(request);
  if (request.method === 'tools/list') return listAnswer(request, session);
  if (request.method === 'tools/call') return callAnswer(request, session);
  return methodNotSupportedAnswer(request);
}

function initializeAnswer(request: RpcRequest, session: Session): unknown {
  return {
    jsonrpc: '2.0',
    id: idOf(request),
    result: {
      protocolVersion: negotiateVersion(requestedVersion(request)),
      capabilities: { tools: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: session.options.serverVersion ?? DEVELOPMENT_VERSION,
      },
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

function listAnswer(request: RpcRequest, session: Session): unknown {
  const bulkLimit = resolveBulkLimit(session.options.env);
  const tools = listTools(session.options.registry, bulkLimit);
  return { jsonrpc: '2.0', id: idOf(request), result: { tools } };
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
 * on). A batch that ran and succeeded on nothing is an error that keeps its envelope:
 * the per-item failures are what the caller needs in order to retry.
 */
function callResultAnswer(request: RpcRequest, outcome: ToolOutcome): unknown {
  const result: Record<string, unknown> = { content: [{ type: 'text', text: outcome.text }] };
  const structuredBody = structuredBodyOf(outcome);
  if (structuredBody !== undefined) result['structuredContent'] = structuredBody;
  if (reportsError(outcome)) result['isError'] = true;
  return { jsonrpc: '2.0', id: idOf(request), result };
}

/** The call threw, or a batch ran and not one item succeeded; one success is still a success. */
function reportsError(outcome: ToolOutcome): boolean {
  return outcome.failed || outcome.nothingSucceeded;
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
    return {
      text: renderOpsResult(result),
      body: result.body,
      failed: false,
      nothingSucceeded: noItemSucceeded(operation.kind, result.body),
    };
  } catch (error) {
    return {
      text: renderFailure(error),
      body: undefined,
      failed: true,
      nothingSucceeded: false,
    };
  }
}

/** A batch's envelope reports how many items ran; only a batch has one to report on (§2.7). */
function noItemSucceeded(kind: OpSpec['kind'], body: unknown): boolean {
  return isBulkKind(kind) && (body as BulkEnvelope).succeeded === 0;
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
    bulkLimit: resolveBulkLimit(session.options.env),
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
  /** The call threw, so there is no payload to branch on. */
  failed: boolean;
  /** A batch ran and every item failed; the envelope is still the payload. */
  nothingSucceeded: boolean;
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
