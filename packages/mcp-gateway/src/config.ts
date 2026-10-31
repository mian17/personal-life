/**
 * The gateway's upstream config (SPEC-mcp-gateway §1 "Registration & config", §9.3, §9.7): the
 * JSON file `MCP_GATEWAY_CONFIG` names, read in the client's own `mcpServers` shape —
 * `{ "mcpServers": { "<configkey>": { command, args, env, cwd? } } }` — and validated once, up
 * front. An app's existing client config block is pasted in whole under its key, and that key
 * becomes the tool-name prefix (so it may only hold `[A-Za-z0-9_.-]`).
 *
 * Every failure here is a `ConfigError` carrying the gateway-local code `-32002` and a message
 * naming the cause — the missing variable, the unreadable path, the JSON parse offset, the
 * non-object `mcpServers`, or the offending key. Never an untyped throw: the server maps this
 * class to a JSON-RPC error verbatim (spec §9.7).
 *
 * The hash is the disk cache's key (Task 5), so it must depend on the config's *content* and
 * nothing else: whitespace, indentation, and the order of an entry's own fields are formatting
 * and hash identically. Declaration order of the `mcpServers` keys is content — it is the merged
 * table's order (spec §9.8) — so it survives into `entries` and into the hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The one variable a deployment sets: the JSON file holding the upstream table. */
export const CONFIG_PATH_VARIABLE = 'MCP_GATEWAY_CONFIG';

/** Gateway-local code for every config failure (spec §9.7, outside MCP's -32020…-32099). */
export const CONFIG_ERROR_CODE = -32002;

/** A config key is a tool-name component, so it may only hold what the name shape allows. */
const LEGAL_CONFIG_KEY = /^[A-Za-z0-9_.-]+$/;

export class ConfigError extends Error {
  readonly code = CONFIG_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** One upstream, exactly as the client's `mcpServers` block declares it. */
export interface UpstreamEntry {
  configKey: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

/** A validated config, its own path (the cache file lives beside it), and its content hash. */
export interface GatewayConfig {
  readonly path: string;
  readonly entries: UpstreamEntry[];
  readonly hash: string;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const path = configPathFrom(env);
  const parsed = parseJson(readConfigFile(path), path);
  const entries = entriesFrom(mcpServersFrom(parsed, path));
  return { path, entries, hash: hashEntries(entries) };
}

function configPathFrom(env: NodeJS.ProcessEnv): string {
  const path = env[CONFIG_PATH_VARIABLE];
  if (!path) throw new ConfigError(`${CONFIG_PATH_VARIABLE} is not set`);
  return path;
}

function readConfigFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read ${CONFIG_PATH_VARIABLE} file ${path}: ${reasonFor(error)}`);
  }
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${reasonFor(error)}`);
  }
}

function mcpServersFrom(parsed: unknown, path: string): Record<string, unknown> {
  const mcpServers = isRecord(parsed) ? parsed.mcpServers : undefined;
  if (!isRecord(mcpServers)) throw new ConfigError(`${path} has no "mcpServers" object`);
  return mcpServers;
}

/**
 * `Object.entries` yields an object's keys in insertion order, which for a parsed `mcpServers`
 * object is the file's declaration order — the merged table's order.
 *
 * ponytail: keys that look like array indices ("51", "0") are reordered first by the JS object
 * itself, so such a key would not keep its declared position. Upgrade path: stream the object's
 * key order out of the raw text and read keys by position, if a real config ever uses one.
 */
function entriesFrom(mcpServers: Record<string, unknown>): UpstreamEntry[] {
  return Object.entries(mcpServers).map(([configKey, shape]) => entryFrom(configKey, shape));
}

function entryFrom(configKey: string, shape: unknown): UpstreamEntry {
  assertLegalConfigKey(configKey);
  if (!isRecord(shape)) throw new ConfigError(`config entry "${configKey}" is not an object`);

  const command = shape.command;
  if (typeof command !== 'string' || command === '') {
    throw new ConfigError(`config entry "${configKey}" has no command`);
  }

  const entry: UpstreamEntry = {
    configKey,
    command,
    args: argsFrom(shape, configKey),
    env: envFrom(shape, configKey),
  };
  const cwd = shape.cwd;
  if (cwd === undefined) return entry;
  if (typeof cwd !== 'string') throw new ConfigError(`config entry "${configKey}" has a non-string cwd`);
  return { ...entry, cwd };
}

function assertLegalConfigKey(configKey: string): void {
  if (LEGAL_CONFIG_KEY.test(configKey)) return;
  throw new ConfigError(`config key "${configKey}" is outside ${LEGAL_CONFIG_KEY.source}`);
}

function argsFrom(shape: Record<string, unknown>, configKey: string): string[] {
  const args = shape.args;
  if (args === undefined) return [];
  if (!isStringArray(args)) throw new ConfigError(`config entry "${configKey}" has non-string args`);
  return args;
}

function envFrom(shape: Record<string, unknown>, configKey: string): Record<string, string> {
  const env = shape.env;
  if (env === undefined) return {};
  if (!isStringRecord(env)) throw new ConfigError(`config entry "${configKey}" has non-string env`);
  return { ...env };
}

function hashEntries(entries: UpstreamEntry[]): string {
  const normalized = JSON.stringify(entries.map(normalizedEntry));
  return createHash('sha256').update(normalized).digest('hex');
}

/** Declaration order stays; field order and `env` key order are formatting, so they are fixed. */
function normalizedEntry(entry: UpstreamEntry): unknown {
  return {
    configKey: entry.configKey,
    command: entry.command,
    args: entry.args,
    env: sortedByKey(entry.env),
    cwd: entry.cwd ?? null,
  };
}

function sortedByKey(env: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) sorted[key] = env[key];
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((element) => typeof element === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((element) => typeof element === 'string');
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
