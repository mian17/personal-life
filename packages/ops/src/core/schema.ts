/**
 * JSON-Schema derivation for the MCP adapter (SPEC.md §3, DRY rule): the schema
 * a `tools/list` tool advertises comes from the same `FieldSpec` table the CLI
 * validates against. Drift between the two is a parity test failure. A bulk op
 * advertises one capped `items` array over its sibling's item table, so the cap
 * a caller reads there is the cap the validator enforces.
 */
import type { BulkKind } from './bulk';
import { bulkItemInput, isBulkKind, resolveBulkLimit } from './bulk';
import type { FieldSpec, OpSpec, ResourceRegistry } from './types';
import { findOp } from './registry';
import { BULK_WRAPPER_FIELD, rejectMalformedDeclaration } from './validate';
import { ADDRESSING_FIELD } from './wire';

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
  /** Array bounds, emitted on a bulk op's `items` and nowhere else (§2.4). */
  minItems?: number;
  maxItems?: number;
}

export interface JsonSchemaProperty extends JsonSchemaValueShape {
  enum?: readonly string[];
  description: string;
}

/**
 * The `inputSchema` one registry op advertises over `tools/list`. A bulk op takes
 * one `items` array capped at `bulkLimit`, which defaults to the cap this
 * environment resolves; every other kind takes its declared field table.
 */
export function deriveInputSchema(
  registry: ResourceRegistry,
  kind: OpSpec['kind'],
  bulkLimit: number = resolveBulkLimit(process.env),
): JsonSchema {
  const operation = findOp(registry, kind);
  rejectMalformedDeclaration(operation);
  return schemaForOp(operation, bulkLimit);
}

function schemaForOp(operation: OpSpec, bulkLimit: number): JsonSchema {
  if (!isBulkKind(operation.kind)) return declaredSchema(operation);
  return wrappedItemsSchema(oneItemShape(operation, operation.kind), bulkLimit);
}

function declaredSchema(operation: OpSpec): JsonSchema {
  return {
    type: 'object',
    properties: propertiesForOp(operation),
    required: requiredFields(operation),
    additionalProperties: false,
  };
}

/** Named on the wrapper property; it carries no number, because the cap is `maxItems` (§2.3). */
const BULK_ITEMS_DESCRIPTION = 'Items of the batch, submitted in order';

/** The one shape every bulk op takes: a required `items` array, and no other key (§2.3). */
function wrappedItemsSchema(itemShape: JsonSchemaValueShape, bulkLimit: number): JsonSchema {
  return {
    type: 'object',
    properties: { [BULK_WRAPPER_FIELD]: cappedItemsProperty(itemShape, bulkLimit) },
    required: [BULK_WRAPPER_FIELD],
    additionalProperties: false,
  };
}

/** The batch array: at least one item, never more than the resolved cap (§2.4). */
function cappedItemsProperty(
  itemShape: JsonSchemaValueShape,
  bulkLimit: number,
): JsonSchemaProperty {
  return {
    type: 'array',
    items: itemShape,
    minItems: 1,
    maxItems: bulkLimit,
    description: BULK_ITEMS_DESCRIPTION,
  };
}

/** One item's shape: the bare address, or the sibling op's field table verbatim (§2.3). */
function oneItemShape(operation: OpSpec, kind: BulkKind): JsonSchemaValueShape {
  return itemsAreBareIds(kind) ? addressingShape(operation) : objectShape(operation.fields);
}

/** True where one item is the address itself: the fan-out wraps it instead of passing it through. */
function itemsAreBareIds(kind: BulkKind): boolean {
  return ADDRESSING_FIELD in bulkItemInput(kind, {});
}

/** A bare id's element type is the sibling op's `id` field type (§2.3). */
function addressingShape(operation: OpSpec): JsonSchemaValueShape {
  return { type: operation.fields[ADDRESSING_FIELD]?.type ?? 'string' };
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

/**
 * The `<resource>_<snake_case kind>` tool name the MCP adapter exposes per operation, and
 * the one camel→snake transform both adapters reach (§2.8): `notes_get_many` beside
 * `notes_get`, because a single-word kind is already snake case.
 */
export function toolName(registry: ResourceRegistry, operation: OpSpec): string {
  return `${registry.name}_${snakeCase(operation.kind)}`;
}

function snakeCase(kind: string): string {
  return kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
