/**
 * The one definition both adapters render (SPEC.md §3, DRY rule).
 * Validation, JSON Schema, and the wire mapping all derive from these
 * descriptors — an adapter that restates any of them is a bug.
 */
export interface FieldSpec {
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required?: boolean;
  enum?: readonly string[];
  description: string;
}

export interface OpSpec {
  /** create | get | list | update | delete — the closed op set (SPEC.md §3). */
  kind: 'create' | 'get' | 'list' | 'update' | 'delete';
  fields: Record<string, FieldSpec>;
}

export interface ResourceSpec {
  name: string;
  basePath: string;
  ops: OpSpec[];
}

export type ResourceRegistry = ResourceSpec;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The service HTTP call one registry op compiles to (SPEC.md §3). */
export interface WireRequest {
  method: HttpMethod;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** One field-level validation failure, rendered canonically by adapters. */
export interface ValidationIssue {
  field: string;
  reason: string;
}
