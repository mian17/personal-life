/**
 * JSON-Schema derivation for the MCP adapter (SPEC.md §3, DRY rule): the schema
 * a `tools/list` tool advertises comes from the same `FieldSpec` table the CLI
 * validates against. Drift between the two is a parity test failure.
 */
import type { FieldSpec, OpSpec, ResourceRegistry } from './types';
import { findOp } from './registry';
import { rejectMalformedDeclaration } from './validate';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

/**
 * One value shape a field declares: a flat scalar, an array of them, or a nested
 * object. Recursive, because an `object[]`'s entries are objects that may nest
 * again — the array case carries an `items` of the same shape.
 */
export interface JsonSchemaValueShape {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchemaValueShape;
}

export interface JsonSchemaProperty extends JsonSchemaValueShape {
  enum?: readonly string[];
  description: string;
}

/** The `inputSchema` one registry op advertises over `tools/list`. */
export function deriveInputSchema(registry: ResourceRegistry, kind: OpSpec['kind']): JsonSchema {
  const operation = findOp(registry, kind);
  rejectMalformedDeclaration(operation);
  return schemaForOp(operation);
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
  return propertiesForFields(operation.fields);
}

function propertiesForFields(fields: Record<string, FieldSpec>): Record<string, JsonSchemaProperty> {
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, field]) => [fieldName, schemaForField(field)]),
  );
}

function requiredFields(operation: OpSpec): string[] {
  return requiredFieldNames(operation.fields);
}

function requiredFieldNames(fields: Record<string, FieldSpec>): string[] {
  return Object.entries(fields)
    .filter(([, field]) => field.required === true)
    .map(([fieldName]) => fieldName);
}

function schemaForField(field: FieldSpec): JsonSchemaProperty {
  const shape = { ...valueShape(field), description: field.description };
  return field.enum === undefined ? shape : { ...shape, enum: field.enum };
}

/** The value shape one field declares, before its description and enum. */
function valueShape(field: FieldSpec): JsonSchemaValueShape {
  if (field.type === 'object') return objectShape(field.properties ?? {});
  if (field.type === 'object[]') return { type: 'array', items: objectShape(field.properties ?? {}) };
  if (field.type === 'string[]') return { type: 'array', items: { type: 'string' } };
  if (field.type === 'number[]') return { type: 'array', items: { type: 'number' } };
  return { type: field.type };
}

/** One nested object shape: its declared keys, its own required list, no unknown keys. */
function objectShape(fields: Record<string, FieldSpec>): JsonSchemaValueShape {
  return {
    type: 'object',
    properties: propertiesForFields(fields),
    required: requiredFieldNames(fields),
    additionalProperties: false,
  };
}

/** The `<resource>_<op>` tool name the MCP adapter exposes per operation. */
export function toolName(registry: ResourceRegistry, operation: OpSpec): string {
  return `${registry.name}_${operation.kind}`;
}
