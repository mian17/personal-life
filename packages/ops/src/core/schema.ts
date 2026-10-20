/**
 * JSON-Schema derivation for the MCP adapter (SPEC.md §3, DRY rule): the schema
 * a `tools/list` tool advertises comes from the same `FieldSpec` table the CLI
 * validates against. Drift between the two is a parity test failure.
 */
import type { FieldSpec, OpSpec, ResourceRegistry } from './types';
import { findOp } from './registry';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

export interface JsonSchemaProperty {
  type: string;
  items?: { type: 'string' };
  enum?: readonly string[];
  description: string;
}

/** The `inputSchema` one registry op advertises over `tools/list`. */
export function deriveInputSchema(registry: ResourceRegistry, kind: OpSpec['kind']): JsonSchema {
  return schemaForOp(findOp(registry, kind));
}

function schemaForOp(operation: OpSpec): JsonSchema {
  return {
    type: 'object',
    properties: propertiesForOp(operation),
    required: requiredFields(operation),
    additionalProperties: false,
  };
}

function propertiesForOp(operation: OpSpec): Record<string, JsonSchemaProperty> {
  return Object.fromEntries(
    Object.entries(operation.fields).map(([fieldName, field]) => [fieldName, schemaForField(field)]),
  );
}

function requiredFields(operation: OpSpec): string[] {
  return Object.entries(operation.fields)
    .filter(([, field]) => field.required === true)
    .map(([fieldName]) => fieldName);
}

function schemaForField(field: FieldSpec): JsonSchemaProperty {
  const shape = { ...baseType(field), description: field.description };
  return field.enum === undefined ? shape : { ...shape, enum: field.enum };
}

function baseType(field: FieldSpec): { type: string; items?: { type: 'string' } } {
  if (field.type === 'string[]') return { type: 'array', items: { type: 'string' } };
  return { type: field.type };
}

/** The `<resource>_<op>` tool name the MCP adapter exposes per operation. */
export function toolName(registry: ResourceRegistry, operation: OpSpec): string {
  return `${registry.name}_${operation.kind}`;
}
