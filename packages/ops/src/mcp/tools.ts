/**
 * The MCP tool surface (SPEC.md §3, §7): every tool is one registry op, named
 * `<resource>_<op>` and carrying the `inputSchema` derived from the same
 * `FieldSpec` table the core validator reads. This file owns nothing but that
 * projection — a tool that restated a schema or a wire shape would be a bug.
 */
import type { JsonSchema } from '../core/schema';
import { deriveInputSchema, toolName } from '../core/schema';
import type { OpSpec, ResourceRegistry } from '../core/types';

/** One `tools/list` entry: the op's name, a one-line choice hint, and its core-derived schema. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** Every registry op as one MCP tool, in registry order. */
export function listTools(registry: ResourceRegistry): McpTool[] {
  return registry.ops.map((operation) => toolFor(registry, operation));
}

/** The op a `tools/call` name selects, or `undefined` when the name is not in the registry. */
export function findTool(registry: ResourceRegistry, name: string): OpSpec | undefined {
  return registry.ops.find((operation) => toolName(registry, operation) === name);
}

function toolFor(registry: ResourceRegistry, operation: OpSpec): McpTool {
  return {
    name: toolName(registry, operation),
    description: describe(registry, operation),
    inputSchema: deriveInputSchema(registry, operation.kind),
  };
}

function describe(registry: ResourceRegistry, operation: OpSpec): string {
  return `${operation.kind} a ${registry.name} record through ${registry.basePath}`;
}
