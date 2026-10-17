/**
 * The MCP stdio server (SPEC.md §3, §10.2): a hand-rolled JSON-RPC stdio loop
 * that answers `tools/list` and `tools/call` and nothing else — no SDK, no third
 * method was agreed. Every call routes through the one shared executor and the
 * one canonical render the CLI uses, so adapter parity is a string comparison,
 * not a convention.
 */
import type { OpSpec, ResourceRegistry } from '../core/types';
import { createExecutor } from '../transport/executor';
import type { Executor } from '../transport/executor';
import { readToken } from '../auth/token-store';
import { renderFailure, renderOpsResult } from '../cli/render';
import { loadService } from '../cli/run';
import { findTool, listTools } from './tools';

/** The stdio-facing server contract: registry + env + injected writers (tests drive stubs). */
export interface McpServerOptions {
  registry: ResourceRegistry;
  /** Overrides `LIFE_OPS_API_BASE` when the service module knows its own base. */
  apiBase?: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** One in-process JSON-RPC handler; `null` is the no-answer shape for a notification. */
export interface McpServer {
  handle(request: unknown): Promise<unknown>;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const session: Session = {
    options,
    executor: createExecutor({
      registry: options.registry,
      baseUrl: apiBase(options),
      readToken,
    }),
  };
  return { handle: (request) => answer(asRequest(request), session) };
}

/** Serve the session until stdin closes, answering every JSON-RPC request. */
export async function main(options: McpServerOptions): Promise<number> {
  return await answerRequestsUntilStdinCloses({ server: createMcpServer(options), options });
}

/** The stdio entry: the service module named by `LIFE_OPS_SERVICE`, then the loop. */
async function serveFromEnvironment(): Promise<void> {
  try {
    const service = await loadService(process.env);
    process.exitCode = await main({
      registry: service.registry,
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
        respondToLine(loop, line);
      }
    });
    process.stdin.on('end', () => finish(0));
  });
}

async function respondToLine(loop: ServerLoop, line: string): Promise<void> {
  try {
    const response = await loop.server.handle(parseLine(line));
    if (response !== null) loop.options.stdout(JSON.stringify(response));
  } catch (error) {
    loop.options.stderr(renderFailure(error));
  }
}

async function answer(request: RpcRequest, session: Session): Promise<unknown> {
  if (request.id === undefined) return null; // a notification gets no answer
  if (request.method === 'tools/list') return listAnswer(request, session.options.registry);
  if (request.method === 'tools/call') return callAnswer(request, session);
  return unhandledMethodAnswer(request);
}

function listAnswer(request: RpcRequest, registry: ResourceRegistry): unknown {
  return { jsonrpc: '2.0', id: idOf(request), result: { tools: listTools(registry) } };
}

async function callAnswer(request: RpcRequest, session: Session): Promise<unknown> {
  try {
    const outcome = await runTool(request, session);
    const result: Record<string, unknown> = { content: [{ type: 'text', text: outcome.text }] };
    if (outcome.failed) result['isError'] = true;
    return { jsonrpc: '2.0', id: idOf(request), result };
  } catch (error) {
    return invalidCallAnswer(request, error);
  }
}

/** A malformed/unknown `tools/call` still gets a JSON-RPC error reply, never silence. */
function invalidCallAnswer(request: RpcRequest, error: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id: idOf(request),
    error: { code: -32602, message: renderFailure(error) },
  };
}

async function runTool(request: RpcRequest, session: Session): Promise<ToolOutcome> {
  const operation = nameOf(request, session.options.registry);
  try {
    const result = await session.executor.run(operation, inputOf(request));
    return { text: renderOpsResult(result), failed: false };
  } catch (error) {
    return { text: renderFailure(error), failed: true };
  }
}

function unhandledMethodAnswer(request: RpcRequest): unknown {
  return {
    jsonrpc: '2.0',
    id: idOf(request),
    error: { code: -32601, message: `method not supported: ${request.method}` },
  };
}

interface Session {
  options: McpServerOptions;
  executor: Executor;
}

interface ServerLoop {
  server: McpServer;
  options: McpServerOptions;
}

interface ToolOutcome {
  text: string;
  failed: boolean;
}

/** `id === undefined` is the notification shape; every other field arrives verbatim. */
interface RpcRequest {
  id: string | number | undefined;
  method: string;
  params: unknown;
}

function parseLine(line: string): unknown {
  return JSON.parse(line) as unknown;
}

function asRequest(parsed: unknown): RpcRequest {
  if (typeof parsed !== 'object' || parsed === null) throw new Error('request is not a JSON object');
  const record = parsed as Record<string, unknown>;
  if (typeof record['method'] !== 'string') throw new Error('request has no method string');
  return { id: requestId(record), method: record['method'], params: record['params'] };
}

function requestId(record: Record<string, unknown>): string | number | undefined {
  if (typeof record['id'] === 'string' || typeof record['id'] === 'number') return record['id'];
  return undefined;
}

function idOf(request: RpcRequest): string | number | null {
  return request.id ?? null;
}

/** The op kind a `tools/call` names, or a thrown error when the registry has no such tool. */
function nameOf(request: RpcRequest, registry: ResourceRegistry): OpSpec['kind'] {
  const name = (request.params as Record<string, unknown> | undefined)?.['name'];
  if (typeof name !== 'string') throw new Error('tools/call has no tool name string');
  const operation = findTool(registry, name);
  if (operation === undefined) throw new Error(`unknown tool: ${name}`);
  return operation.kind;
}

/** The `arguments` object of the call; an absent one behaves as an empty input. */
function inputOf(request: RpcRequest): Record<string, unknown> {
  const args = (request.params as Record<string, unknown> | undefined)?.['arguments'];
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/** `service.apiBase` wins over `LIFE_OPS_API_BASE`, the same rule the CLI applies. */
function apiBase(options: McpServerOptions): string {
  const configured = options.apiBase ?? options.env.LIFE_OPS_API_BASE?.trim();
  if (!configured) throw new Error('LIFE_OPS_API_BASE is not set; point it at the service API base');
  return configured;
}

if (require.main === module) {
  void serveFromEnvironment();
}