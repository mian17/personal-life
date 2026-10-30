/**
 * The MCP tool surface (SPEC.md §3, §7, SPEC-ops-agent-contract §3.2): every tool
 * is one registry op, named `<resource>_<op>`, titled `"<Verb> <resource>"`,
 * carrying the `inputSchema` derived from the same `FieldSpec` table the core
 * validator reads, and carrying the four behavior hints a human-in-the-loop gate
 * reads. Every served registry contributes its ops, in load order then registry
 * order, so one server serves the union one multi-service run loaded
 * (SPEC-ops-all-services §1.1.2). This file owns nothing but that projection — a
 * tool that restated a schema or a wire shape would be a bug.
 */
import type { JsonSchema } from '../core/schema';
import { deriveInputSchema, toolName } from '../core/schema';
import type { OpSpec, ResourceRegistry } from '../core/types';

/** The four MCP behavior hints, always stated rather than left to protocol defaults. */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** One `tools/list` entry: name, human title, one-line choice hint, schema, hints. */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
}

/** One registry, or the whole union one multi-service run loaded. */
export type RegistryUnion = ResourceRegistry | ResourceRegistry[];

/** The registry that owns one `tools/call` name, and the op there it names. */
export interface ToolLocation {
  registry: ResourceRegistry;
  operation: OpSpec;
}

/** Every served registry's ops as MCP tools, in load order then registry order. */
export function listTools(registrySet: RegistryUnion): McpTool[] {
  return everyRegistry(registrySet).flatMap((registry) =>
    registry.ops.map((operation) => toolFor(registry, operation)),
  );
}

/** The registry and op a `tools/call` name selects; `undefined` when no served registry holds it. */
export function findTool(registrySet: RegistryUnion, name: string): ToolLocation | undefined {
  for (const registry of everyRegistry(registrySet)) {
    const operation = operationNamed(registry, name);
    if (operation !== undefined) return { registry, operation };
  }
  return undefined;
}

/** The registries one argument stands for: a single-service run names one, a union names all. */
export function everyRegistry(registrySet: RegistryUnion): ResourceRegistry[] {
  return Array.isArray(registrySet) ? registrySet : [registrySet];
}

function operationNamed(registry: ResourceRegistry, name: string): OpSpec | undefined {
  return registry.ops.find((operation) => toolName(registry, operation) === name);
}

function toolFor(registry: ResourceRegistry, operation: OpSpec): McpTool {
  return {
    name: toolName(registry, operation),
    title: titleFor(registry, operation),
    description: describe(registry, operation),
    inputSchema: deriveInputSchema(registry, operation.kind),
    annotations: annotationsFor(operation),
  };
}

/** How a client labels the tool in a prompt: `Get sample`, `Delete sample`. */
function titleFor(registry: ResourceRegistry, operation: OpSpec): string {
  return `${capitalize(operation.kind)} ${registry.name}`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The kind's hints, then the op's frozen flag where the author overrode it
 * (SPEC-ops-agent-contract §3.2). The override wins in both directions: it can
 * clear a mutating op's destructiveness and it can mark a read destructive.
 */
function annotationsFor(operation: OpSpec): ToolAnnotations {
  const kindHints = HINTS_BY_KIND[operation.kind];
  return { ...kindHints, destructiveHint: operation.isDestructive ?? kindHints.destructiveHint };
}

/**
 * Every op reaches one in-repo service at a fixed base URL, so no call opens the
 * agent's world; writes default to destructive until their author opts out.
 */
const HINTS_BY_KIND: Readonly<Record<OpSpec['kind'], ToolAnnotations>> = {
  get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  create: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  delete: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  restore: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function describe(registry: ResourceRegistry, operation: OpSpec): string {
  return `${operation.kind} a ${registry.name} record through ${registry.basePath}`;
}
