/**
 * The one definition both adapters render (SPEC.md §3, DRY rule).
 * Validation, JSON Schema, and the wire mapping all derive from these
 * descriptors — an adapter that restates any of them is a bug.
 */
export interface FieldSpec {
  /**
   * The closed type set: `string`, `number`, `boolean`, `string[]`, `number[]`.
   * `number[]` carries service ids (`tagIds`); the service rejects text entries,
   * so the CLI converts repeated numeric flags rather than the wire.
   */
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  required?: boolean;
  enum?: readonly string[];
  description: string;
}

export interface OpSpec {
  /**
   * create | get | list | update | delete | restore — the closed op set
   * (SPEC.md §3). `restore` brings one deleted row back and addresses it with
   * the same `id` segment the other row ops use.
   */
  kind: 'create' | 'get' | 'list' | 'update' | 'delete' | 'restore';
  fields: Record<string, FieldSpec>;
  /**
   * Overrides the kind default. Defaults: true for create/update/delete/restore,
   * false for get/list. `false` on a mutating op is an explicit statement
   * that this write may run without human approval (SPEC-ops-agent-contract §3.2).
   */
  isDestructive?: boolean;
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
