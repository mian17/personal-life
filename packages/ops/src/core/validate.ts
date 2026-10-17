/**
 * The runtime validator both adapters share (SPEC.md §3): inputs pass through
 * here before any network call, so a local failure never reaches the service.
 * The MCP `inputSchema` tests against the same case table as this validator —
 * schema drift is a test failure, not a silent gap.
 */
import type { FieldSpec, OpSpec, ValidationIssue } from './types';
import { fieldEntry } from './registry';

/** True when every supplied value matches its descriptor and required fields exist. */
export function validateInput(
  operation: OpSpec,
  supplied: Record<string, unknown>,
): ValidationIssue[] {
  return [...missingRequired(operation, supplied), ...failedChecks(operation, supplied)];
}

function missingRequired(operation: OpSpec, supplied: Record<string, unknown>): ValidationIssue[] {
  return Object.entries(operation.fields)
    .filter(([, field]) => field.required === true)
    .filter(([fieldName]) => supplied[fieldName] === undefined)
    .map(([fieldName]) => ({ field: fieldName, reason: 'required' }));
}

function failedChecks(operation: OpSpec, supplied: Record<string, unknown>): ValidationIssue[] {
  return Object.entries(supplied).flatMap(([fieldName, value]) => {
    const issue = checkSupplied(operation, fieldName, value);
    return issue === null ? [] : [issue];
  });
}

function checkSupplied(operation: OpSpec, fieldName: string, value: unknown): ValidationIssue | null {
  if (value === undefined) return null;
  const entry = fieldEntry(operation, fieldName);
  if (entry === undefined) return { field: fieldName, reason: 'unknown field' };
  return checkValue(fieldName, value, entry[1]);
}

function checkValue(fieldName: string, value: unknown, field: FieldSpec): ValidationIssue | null {
  if (!hasExpectedShape(value, field)) return { field: fieldName, reason: `expected ${field.type}` };
  if (typeof value === 'string' && field.enum !== undefined && !field.enum.includes(value)) {
    return { field: fieldName, reason: `expected one of ${field.enum.join(', ')}` };
  }
  return null;
}

function hasExpectedShape(value: unknown, field: FieldSpec): boolean {
  switch (field.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
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
