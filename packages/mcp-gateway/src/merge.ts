/**
 * The merged `tools/list` table (SPEC-mcp-gateway §2 "Objective", §9.8): every upstream tool
 * renamed to `<configkey>__<tool>` and nothing else touched — `description`, `inputSchema`,
 * `annotations`, `defer_loading`, `tool_reference`, `_meta`, and any field the gateway does not
 * understand pass through byte-identical. A name that collides with one already merged, or that
 * leaves the spec's `^[A-Za-z0-9_.-]{1,128}$` shape, is a merge failure: never a rename, never a
 * silent drop (spec §2 "Tool naming").
 *
 * Order is deterministic by construction: the slice array arrives in config declaration order and
 * each slice keeps its upstream's own `tools/list` order, so insertion order into the forwarded
 * map is the order callers read.
 *
 * Both failures carry the gateway-local `-32001` (spec §9.7) and name their offender, so the
 * server can map the throw to a JSON-RPC error without re-deriving what went wrong.
 */

/** Gateway-local code for every merge failure (spec §9.7). */
export const MERGE_ERROR_CODE = -32001;

/** The forwarded name shape the spec pins: 1–128 chars of `[A-Za-z0-9_.-]`. */
const LEGAL_MERGED_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/** One upstream tool as it arrived: the name the merger rewrites, plus every field it keeps. */
export interface UpstreamTool {
  readonly name: string;
  readonly [field: string]: unknown;
}

/** A tool in the merged table: the upstream's own fields, with only `name` rewritten. */
export type ForwardedTool = UpstreamTool;

/** One upstream's `tools/list` table, read under its config key. */
export interface UpstreamSlice {
  readonly configKey: string;
  readonly tools: readonly UpstreamTool[];
}

/** An upstream tool whose forwarded name breaks the spec's name shape. */
interface IllegalName {
  readonly configKey: string;
  readonly toolName: string;
  readonly forwardedName: string;
}

/** A merged name claimed twice, with the two config keys that claimed it. */
interface NameCollision {
  readonly forwardedName: string;
  readonly firstConfigKey: string;
  readonly laterConfigKey: string;
}

/** A name outside the legal shape: the offending tool, its key, and the name they produced. */
export class IllegalToolName extends Error {
  readonly code = MERGE_ERROR_CODE;
  readonly configKey: string;
  readonly toolName: string;

  constructor(illegal: IllegalName) {
    super(
      `tool "${illegal.toolName}" of config key "${illegal.configKey}" forwards to ` +
        `"${illegal.forwardedName}", which is outside ${LEGAL_MERGED_NAME.source}`,
    );
    this.name = 'IllegalToolName';
    this.configKey = illegal.configKey;
    this.toolName = illegal.toolName;
  }
}

/** Two upstreams producing one name: names both keys, so the config can be fixed. */
export class MergeCollision extends Error {
  readonly code = MERGE_ERROR_CODE;
  readonly forwardedName: string;
  readonly configKeys: readonly string[];

  constructor(collision: NameCollision) {
    super(
      `merged tool name "${collision.forwardedName}" is claimed by config keys ` +
        `"${collision.firstConfigKey}" and "${collision.laterConfigKey}"`,
    );
    this.name = 'MergeCollision';
    this.forwardedName = collision.forwardedName;
    this.configKeys = [collision.firstConfigKey, collision.laterConfigKey];
  }
}

export function mergeToolTables(slices: UpstreamSlice[]): ForwardedTool[] {
  const claims = new Map<string, Claim>();

  for (const slice of slices) {
    for (const tool of slice.tools) {
      claimName(claims, claimFor(slice, tool));
    }
  }

  return [...claims.values()].map((claim) => claim.forwarded);
}

/** One upstream tool holding a forwarded name, remembering which key it came from. */
interface Claim {
  readonly configKey: string;
  readonly toolName: string;
  readonly forwardedName: string;
  readonly forwarded: ForwardedTool;
}

function claimFor(slice: UpstreamSlice, tool: UpstreamTool): Claim {
  const forwardedName = nameForwarded(slice.configKey, tool.name);
  return {
    configKey: slice.configKey,
    toolName: tool.name,
    forwardedName,
    forwarded: { ...tool, name: forwardedName },
  };
}

/** Take the name, or fail naming both the key that already holds it and the key that repeats it. */
function claimName(claims: Map<string, Claim>, claim: Claim): void {
  const owner = claims.get(claim.forwardedName);
  if (owner !== undefined) {
    throw new MergeCollision({
      forwardedName: claim.forwardedName,
      firstConfigKey: owner.configKey,
      laterConfigKey: claim.configKey,
    });
  }
  claims.set(claim.forwardedName, claim);
}

/**
 * `<configkey>__<tool>`, prefixed exactly once: a tool whose own name already carries a prefix
 * keeps it as part of the tool name and gains only this upstream's key in front.
 */
function nameForwarded(configKey: string, toolName: string): string {
  const forwardedName = `${configKey}__${toolName}`;
  if (!LEGAL_MERGED_NAME.test(forwardedName)) {
    throw new IllegalToolName({ configKey, toolName, forwardedName });
  }
  return forwardedName;
}
