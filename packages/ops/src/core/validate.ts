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
import type { FieldSpec, OpSpec, ValidationIssue } from './types';

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
 * failure reads as its full path (`items.0.nutrients.sodium`).
 */
export function validateInput(operation: OpSpec, supplied: Record<string, unknown>): ValidationIssue[] {
  rejectMalformedDeclaration(operation);
  return judgedInput({ fieldPath: '', fields: operation.fields }, supplied);
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
    .filter(([fieldName]) => supplied[fieldName] === undefined)
    .map(([fieldName]) => ({ field: joinPath(context.fieldPath, fieldName), reason: 'required' }));
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
