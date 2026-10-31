/**
 * The runtime validator both adapters share (SPEC.md §3): inputs pass through
 * here before any network call, so a local failure never reaches the service.
 * The MCP `inputSchema` tests against the same case table as this validator —
 * schema drift is a test failure, not a silent gap.
 *
 * One recursive walk serves both entry points: `validateInput` judges supplied
 * values against a descriptor table, `shapeProblems` judges the table itself.
 * Every adapter entry point refuses a table that fails the shape guard —
 * `validateInput` here, `deriveInputSchema` in schema.ts — so a malformed
 * declaration fails before any tool schema or request exists to carry it.
 */
import type { BulkKind } from './bulk';
import { bulkItemInput, isBulkKind, resolveBulkLimit } from './bulk';
import type { FieldSpec, OpSpec, ValidationIssue } from './types';

/**
 * The one field every bulk op takes: one submitted item per entry (§2.3). The
 * registry refuses an opt-in whose source op already declares this name.
 */
export const BULK_WRAPPER_FIELD = 'items';

/** One submitted batch, with the kind and cap needed to judge it (§2.4, §2.5). */
interface SubmittedBatch {
  kind: BulkKind;
  supplied: Record<string, unknown>;
  bulkLimit: number;
}

/** One item of a batch, at the index its dotted path starts from. */
interface JudgedItem {
  kind: BulkKind;
  index: number;
  item: unknown;
}

/** A descriptor table together with the dotted path it sits at (`items.0`). */
interface FieldTable {
  fieldPath: string;
  fields: Record<string, FieldSpec>;
}

/** One field at the dotted path a caller reads it from, declared or not. */
interface LocatedField {
  fieldPath: string;
  field: FieldSpec | undefined;
}

/**
 * Every supplied value matches its descriptor and every required field exists.
 * Nested types are checked by the same walk a top-level field reaches, so a
 * failure reads as its full path (`items.0.nutrients.sodium`). A bulk op is
 * judged as one batch: its envelope first, then each item at its own path.
 */
export function validateInput(
  operation: OpSpec,
  supplied: Record<string, unknown>,
  bulkLimit: number = resolveBulkLimit(process.env),
): ValidationIssue[] {
  rejectMalformedDeclaration(operation);
  if (!isBulkKind(operation.kind)) {
    return judgedInput({ fieldPath: '', fields: operation.fields }, supplied);
  }
  return bulkBatchIssues(operation, { kind: operation.kind, supplied, bulkLimit });
}

/**
 * The batch-level refusals, or the items — a call-level failure reaches no request
 * (§2.5). The envelope is judged with the same unknown-key rule every other op
 * takes (`additionalProperties: false`), so a key the schema never advertises is
 * refused here rather than riding along unread.
 */
function bulkBatchIssues(operation: OpSpec, batch: SubmittedBatch): ValidationIssue[] {
  const items = batch.supplied[BULK_WRAPPER_FIELD];
  if (!Array.isArray(items)) {
    return [{ field: BULK_WRAPPER_FIELD, reason: batchEnvelopeReason(items) }];
  }
  const envelopeIssues = unknownEnvelopeFields(
    Object.keys(batch.supplied).filter((fieldName) => fieldName !== BULK_WRAPPER_FIELD),
  );
  if (envelopeIssues.length > 0) return envelopeIssues;
  const sizeReason = batchSizeReason(items.length, batch.bulkLimit);
  if (sizeReason !== undefined) return [{ field: BULK_WRAPPER_FIELD, reason: sizeReason }];
  return items.flatMap((item, index) =>
    bulkItemIssues(operation, { kind: batch.kind, index, item }),
  );
}

/** A bulk call takes `items` and nothing else, so every other supplied key is unknown (§2.3). */
function unknownEnvelopeFields(fieldNames: string[]): ValidationIssue[] {
  return fieldNames.map((fieldName) => ({ field: fieldName, reason: 'unknown field' }));
}

/** A batch nobody sent is missing; a batch that is not a list is the wrong type. */
function batchEnvelopeReason(items: unknown): string {
  return items === undefined ? 'required' : 'expected array';
}

/** At least one item, and never more than the resolved cap — which the message names (§2.4). */
function batchSizeReason(itemCount: number, bulkLimit: number): string | undefined {
  if (itemCount === 0) return 'at least one item required';
  if (itemCount > bulkLimit) return `exceeds LIFE_OPS_BULK_LIMIT (${bulkLimit})`;
  return undefined;
}

/** One item judged against the sibling's table, read from `items.<index>` downward (§2.5). */
function bulkItemIssues(operation: OpSpec, judged: JudgedItem): ValidationIssue[] {
  const context: FieldTable = {
    fieldPath: `${BULK_WRAPPER_FIELD}.${judged.index}`,
    fields: operation.fields,
  };
  return elementIssues(context, bulkItemInput(judged.kind, judged.item));
}

/**
 * The malformed declarations in one op's descriptor table, each named by its
 * field path: a nested type with no `properties`, a flat type carrying one, or a
 * nested field on a query-bearing op, where no body exists to carry the value.
 */
export function shapeProblems(operation: OpSpec): string[] {
  return [
    ...queryFieldProblems(operation),
    ...declaredShapeProblems({ fieldPath: '', fields: operation.fields }),
  ];
}

/** Refuse a table the adapters cannot render; the message names every problem at once. */
export function rejectMalformedDeclaration(operation: OpSpec): void {
  const problems = shapeProblems(operation);
  if (problems.length === 0) return;
  throw new Error(`malformed ${operation.kind} declaration: ${problems.join('; ')}`);
}

/** A query parameter is one flat value, so only a body-bearing kind may nest. */
function queryFieldProblems(operation: OpSpec): string[] {
  if (operation.kind !== 'list') return [];
  return Object.entries(operation.fields)
    .filter(([, field]) => isNestedType(field.type))
    .map(([fieldName, field]) => `${fieldName}: ${field.type} on a query op`);
}

function judgedInput(context: FieldTable, supplied: Record<string, unknown>): ValidationIssue[] {
  return [...missingProperties(context, supplied), ...wrongValues(context, supplied)];
}

function missingProperties(context: FieldTable, supplied: Record<string, unknown>): ValidationIssue[] {
  return Object.entries(context.fields)
    .filter(([, field]) => field.required === true)
    .filter(([fieldName, field]) => holdsNothing(field, supplied[fieldName]))
    .map(([fieldName]) => ({ field: joinPath(context.fieldPath, fieldName), reason: 'required' }));
}

/**
 * A flag whose value carries no address: an empty string is one `--id` with no value
 * arrives as, and it must fail here rather than compile into a collection path.
 */
function holdsNothing(field: FieldSpec, value: unknown): boolean {
  if (value === undefined) return true;
  return field.type === 'string' && value === '';
}

function wrongValues(context: FieldTable, supplied: Record<string, unknown>): ValidationIssue[] {
  return Object.entries(supplied).flatMap(([fieldName, value]) =>
    valueIssues(fieldLocatedAt(context, fieldName), value),
  );
}

/** The field a supplied key names, located at the path the walk reached. */
function fieldLocatedAt(context: FieldTable, fieldName: string): LocatedField {
  return { fieldPath: joinPath(context.fieldPath, fieldName), field: context.fields[fieldName] };
}

function valueIssues(located: LocatedField, value: unknown): ValidationIssue[] {
  const { fieldPath, field } = located;
  if (value === undefined) return [];
  if (field === undefined) return [{ field: fieldPath, reason: 'unknown field' }];
  if (!hasExpectedShape(value, field)) return [{ field: fieldPath, reason: `expected ${field.type}` }];
  return [...enumIssues(located, value), ...nestedIssues(located, value)];
}

function enumIssues(located: LocatedField, value: unknown): ValidationIssue[] {
  const { fieldPath, field } = located;
  if (typeof value !== 'string' || field?.enum === undefined || field.enum.includes(value)) return [];
  return [{ field: fieldPath, reason: `expected one of ${field.enum.join(', ')}` }];
}

/** The issues inside one nested value, or none when the field declares no keys. */
function nestedIssues(located: LocatedField, value: unknown): ValidationIssue[] {
  const { fieldPath, field } = located;
  if (field === undefined || !hasProperties(field)) return [];
  const elementTable = { fieldPath, fields: field.properties };
  if (field.type === 'object') return elementIssues(elementTable, value);
  if (!Array.isArray(value)) return [];
  return value.flatMap((element, index) =>
    elementIssues({ ...elementTable, fieldPath: `${fieldPath}.${index}` }, element),
  );
}

/** Every issue inside one nested object, judged against the keys it declares. */
function elementIssues(context: FieldTable, value: unknown): ValidationIssue[] {
  if (!isNonArrayObject(value)) return [{ field: context.fieldPath, reason: 'expected object' }];
  return judgedInput(context, value as Record<string, unknown>);
}

function hasExpectedShape(value: unknown, field: FieldSpec): boolean {
  switch (field.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return isFiniteNumber(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    case 'number[]':
      return Array.isArray(value) && value.every(isFiniteNumber);
    case 'object':
      return isNonArrayObject(value);
    case 'object[]':
      return Array.isArray(value);
  }
}

type NestedField = FieldSpec & { properties: Record<string, FieldSpec> };

function hasProperties(field: FieldSpec): field is NestedField {
  return field.properties !== undefined && isNestedType(field.type);
}

function declaredShapeProblems(context: FieldTable): string[] {
  return Object.entries(context.fields).flatMap(([fieldName, field]) =>
    fieldShapeProblems(joinPath(context.fieldPath, fieldName), field),
  );
}

function fieldShapeProblems(fieldPath: string, field: FieldSpec): string[] {
  if (!isNestedType(field.type)) return flatFieldProblems(fieldPath, field);
  if (field.properties === undefined) return [`${fieldPath}: ${field.type} without properties`];
  return declaredShapeProblems({ fieldPath, fields: field.properties });
}

function flatFieldProblems(fieldPath: string, field: FieldSpec): string[] {
  if (field.properties === undefined) return [];
  return [`${fieldPath}: properties on flat field ${field.type}`];
}

function isNestedType(type: FieldSpec['type']): boolean {
  return type === 'object' || type === 'object[]';
}

function joinPath(fieldPath: string, fieldName: string): string {
  return fieldPath === '' ? fieldName : `${fieldPath}.${fieldName}`;
}

function isNonArrayObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The canonical failure text adapters render before any network call. */
export function describeIssues(
  resourceName: string,
  kind: OpSpec['kind'],
  issues: ValidationIssue[],
): string {
  const details = issues.map((issue) => `${issue.field}: ${issue.reason}`).join('; ');
  return `invalid input for ${resourceName}.${kind}: ${details}`;
}
