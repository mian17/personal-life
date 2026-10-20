/**
 * Wire mapping (SPEC.md §3, DRY rule): one registry op compiles to the method,
 * path, query, and body the service HTTP contract expects (kernel API surface
 * rules). Both adapters call `wireFor`; neither restates the mapping.
 *
 * Conventions the service contract fixes:
 * - `id` addresses one row (path segment); everything else carries the payload.
 * - `list` sends every supplied field as a query parameter — cursor pagination
 *   passes through untouched, the core never interprets the cursor payload.
 * - `update` patches the addressed row; `expectedVersion` rides in the body and
 *   the service raises `409` on a stale value (kernel concurrency rule).
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
  }
}

function pathFor(
  registry: ResourceRegistry,
  operation: OpSpec,
  supplied: Record<string, unknown>,
): string {
  if (!addressesOneRow(operation)) return registry.basePath;
  return `${registry.basePath}/${encodeURIComponent(String(supplied[ADDRESSING_FIELD]))}`;
}

function addressesOneRow(operation: OpSpec): boolean {
  return (
    (operation.kind === 'get' || operation.kind === 'update' || operation.kind === 'delete') &&
    ADDRESSING_FIELD in operation.fields
  );
}

function queryFor(operation: OpSpec, supplied: Record<string, unknown>): Record<string, string> {
  if (operation.kind !== 'list') return {};
  return Object.fromEntries(suppliedEntries(operation, supplied).map(asQueryPair));
}

function asQueryPair([fieldName, value]: [string, unknown]): [string, string] {
  return [fieldName, String(value)];
}

function bodyFor(operation: OpSpec, supplied: Record<string, unknown>): WireRequest['body'] {
  if (operation.kind === 'get' || operation.kind === 'delete') return undefined;
  return Object.fromEntries(payloadEntries(operation, supplied));
}

/** Supplied fields only, minus the address: absent optionals never reach the wire. */
function payloadEntries(operation: OpSpec, supplied: Record<string, unknown>): [string, unknown][] {
  if (operation.kind === 'list') return [];
  return suppliedEntries(operation, supplied).filter(([fieldName]) => fieldName !== ADDRESSING_FIELD);
}

/** Supplied fields only: absent optional fields must never appear on the wire. */
function suppliedEntries(operation: OpSpec, supplied: Record<string, unknown>): [string, unknown][] {
  return Object.entries(supplied).filter(
    ([fieldName, value]) => value !== undefined && fieldName in operation.fields,
  );
}
