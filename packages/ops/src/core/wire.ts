/**
 * Wire mapping (SPEC.md §3, DRY rule): one registry op compiles to the method,
 * path, query, and body the service HTTP contract expects (kernel API surface
 * rules). Both adapters call `wireFor`; neither restates the mapping.
 *
 * Conventions the service contract fixes:
 * - `id` addresses one row (path segment); everything else carries the payload.
 *   A create addresses nothing, so an `id` one declares travels in the body —
 *   the client-supplied idempotency key a submission sends.
 * - `list` sends every supplied field as a query parameter — cursor pagination
 *   passes through untouched, the core never interprets the cursor payload.
 * - `update` patches the addressed row; `expectedVersion` rides in the body and
 *   the service raises `409` on a stale value (kernel concurrency rule).
 * - `restore` posts to the addressed row's `restore` sub-path and carries no body:
 *   the address is the whole request (SPEC-ops-agent-contract §3.2).
 * - a nested value travels in the body exactly as supplied: the core decides which
 *   fields travel, never what a value becomes. Nested fields are body-only, so a
 *   query-bearing `list` op may not declare one — that declaration is refused by
 *   the shape guard before any schema or request exists (core/validate.ts).
 */
import type { OpSpec, ResourceRegistry, WireRequest } from './types';
import { findOp } from './registry';

const ADDRESSING_FIELD = 'id';

export function wireFor(
  registry: ResourceRegistry,
  kind: OpSpec['kind'],
  supplied: Record<string, unknown>,
): WireRequest {
  const operation = findOp(registry, kind);
  return {
    method: methodFor(operation),
    path: pathFor(registry, operation, supplied),
    query: queryFor(operation, supplied),
    body: bodyFor(operation, supplied),
  };
}

function methodFor(operation: OpSpec): WireRequest['method'] {
  switch (operation.kind) {
    case 'create':
      return 'POST';
    case 'get':
      return 'GET';
    case 'list':
      return 'GET';
    case 'update':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
    case 'restore':
      return 'POST';
  }
}

function pathFor(
  registry: ResourceRegistry,
  operation: OpSpec,
  supplied: Record<string, unknown>,
): string {
  if (!addressesOneRow(operation)) return registry.basePath;
  const rowPath = `${registry.basePath}/${encodeURIComponent(addressedRowId(supplied))}`;
  return operation.kind === 'restore' ? `${rowPath}/${RESTORE_SEGMENT}` : rowPath;
}

/**
 * Validation refuses an empty required `id` before the wire exists; this is the last gate,
 * so a request can never quietly address the collection in place of one row.
 */
function addressedRowId(supplied: Record<string, unknown>): string {
  const id = String(supplied[ADDRESSING_FIELD]);
  if (id === '') throw new Error(`cannot address one row of ${ADDRESSING_FIELD}: empty value`);
  return id;
}

const RESTORE_SEGMENT = 'restore';

function addressesOneRow(operation: OpSpec): boolean {
  return ROW_KINDS.has(operation.kind) && ADDRESSING_FIELD in operation.fields;
}

/** The kinds whose request names a single row; the rest act on the collection. */
const ROW_KINDS: ReadonlySet<OpSpec['kind']> = new Set(['get', 'update', 'delete', 'restore']);

function queryFor(operation: OpSpec, supplied: Record<string, unknown>): Record<string, string> {
  if (operation.kind !== 'list') return {};
  return Object.fromEntries(suppliedEntries(operation, supplied).map(asQueryPair));
}

function asQueryPair([fieldName, value]: [string, unknown]): [string, string] {
  return [fieldName, String(value)];
}

function bodyFor(operation: OpSpec, supplied: Record<string, unknown>): WireRequest['body'] {
  if (BODYLESS_KINDS.has(operation.kind)) return undefined;
  return Object.fromEntries(payloadEntries(operation, supplied));
}

/** Kinds whose request carries its whole meaning in method and path. */
const BODYLESS_KINDS: ReadonlySet<OpSpec['kind']> = new Set(['get', 'delete', 'restore']);

/** Supplied fields only: absent optional fields must never appear on the wire. */
function suppliedEntries(operation: OpSpec, supplied: Record<string, unknown>): [string, unknown][] {
  return Object.entries(supplied).filter(
    ([fieldName, value]) => value !== undefined && fieldName in operation.fields,
  );
}

/** The fields that ride in a body: every supplied field, minus the address when a row op holds it. */
function payloadEntries(operation: OpSpec, supplied: Record<string, unknown>): [string, unknown][] {
  if (operation.kind === 'list') return [];
  return suppliedEntries(operation, supplied).filter(([fieldName]) =>
    carriesPayload(operation, fieldName),
  );
}

/**
 * A row op carries its `id` in the path, so the body must not repeat it. A create
 * carries no address, so an `id` it declares is payload — the client-supplied
 * idempotency key a feedback submission sends.
 */
function carriesPayload(operation: OpSpec, fieldName: string): boolean {
  return fieldName !== ADDRESSING_FIELD || !addressesOneRow(operation);
}
