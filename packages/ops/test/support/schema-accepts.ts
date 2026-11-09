/**
 * The schema judgement both suites need (SPEC.md §3): true when `supplied`
 * passes the JSON Schema an adapter advertises, judged the way a client reads
 * it — top level, then every declared key, recursing through nested objects and
 * arrays. A nested case table can then assert the validator's verdict and the
 * schema's verdict on the same input, which is what makes drift a failure.
 */
import type {
  JsonSchema,
  JsonSchemaProperty,
  JsonSchemaValueShape,
} from '../../src/core/schema.js';

export function accepts(schema: JsonSchema, supplied: Record<string, unknown>): boolean {
  if (schema.required.some((name) => supplied[name] === undefined)) return false;
  if (!declaresEveryKey(schema, supplied)) return false;
  return Object.entries(supplied).every(([name, value]) =>
    matchesValue(schema.properties[name], value),
  );
}

/** One value against its declared shape; an undeclared shape carries no constraint here. */
function matchesValue(shape: JsonSchemaValueShape | undefined, value: unknown): boolean {
  if (value === undefined || shape === undefined) return true;
  if (!hasType(shape, value)) return false;
  const allowed = declaredEnum(shape);
  return allowed === undefined || allowed.includes(value as string);
}

/** Only a field carries an `enum`; an array's item shape never does. */
function declaredEnum(shape: JsonSchemaValueShape): readonly string[] | undefined {
  return 'enum' in shape ? (shape as JsonSchemaProperty).enum : undefined;
}

function hasType(shape: JsonSchemaValueShape, value: unknown): boolean {
  if (shape.type === 'array') return hasEveryItem(shape.items, value);
  if (shape.type === 'object') return isObjectShape(shape, value);
  if (shape.type === 'number') return isFiniteNumber(value);
  return typeof value === shape.type;
}

function hasEveryItem(item: JsonSchemaValueShape | undefined, value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => matchesValue(item, entry));
}

/** An object: every declared key holds, every required key exists, no undeclared key. */
function isObjectShape(shape: JsonSchemaValueShape, value: unknown): boolean {
  if (!isNonArrayObject(value)) return false;
  const supplied = value as Record<string, unknown>;
  if ((shape.required ?? []).some((name) => supplied[name] === undefined)) return false;
  if (!declaresEveryKey(shape, supplied)) return false;
  return Object.entries(supplied).every(([name, entry]) =>
    matchesValue(shape.properties?.[name], entry),
  );
}

/** A shape that closes its key set rejects a supplied key it never declares. */
function declaresEveryKey(
  shape: { properties?: Record<string, JsonSchemaProperty>; additionalProperties?: false },
  supplied: Record<string, unknown>,
): boolean {
  if (shape.additionalProperties !== false) return true;
  return Object.keys(supplied).every((name) => name in (shape.properties ?? {}));
}

function isNonArrayObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
