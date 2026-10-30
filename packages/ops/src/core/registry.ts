/**
 * The registry core (SPEC.md §3, §6): one `defineResource` call per service
 * declares its resources, and every adapter reads the same `ResourceRegistry`.
 * Nothing here touches validation, schemas, or the wire — those derive from the
 * registry in sibling modules.
 */
import type { FieldSpec, OpSpec, ResourceRegistry, ResourceSpec } from './types';

/**
 * Build the frozen registry both adapters render. `normalizeOp` fills the
 * descriptor defaults so downstream modules read one canonical shape.
 */
export function defineResource(spec: ResourceSpec): ResourceRegistry {
  return deepFreeze({
    ...spec,
    ops: spec.ops.map((op) => normalizeOp(op)),
  });
}

function normalizeOp(operation: OpSpec): OpSpec {
  return {
    kind: operation.kind,
    fields: normalizeFields(operation.fields),
    isDestructive: operation.isDestructive ?? kindIsDestructive(operation.kind),
  };
}

const DESTRUCTIVE_KINDS: Readonly<Record<OpSpec['kind'], boolean>> = {
  create: true,
  get: false,
  list: false,
  update: true,
  delete: true,
  restore: true,
};

/**
 * Whether an op of this kind may destroy data unless its author says otherwise
 * (SPEC-ops-agent-contract §3.2). Writes default to destructive: fail-safe until
 * the author who knows the write is recoverable opts out.
 */
export function kindIsDestructive(kind: OpSpec['kind']): boolean {
  return DESTRUCTIVE_KINDS[kind];
}

function normalizeFields(fields: Record<string, FieldSpec>): Record<string, FieldSpec> {
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, field]) => [fieldName, normalizeField(field)]),
  );
}

function normalizeField(field: FieldSpec): FieldSpec {
  const normalized: FieldSpec = {
    type: field.type,
    required: field.required ?? false,
    description: field.description,
  };
  const withEnum =
    field.enum === undefined ? normalized : { ...normalized, enum: [...field.enum] };
  return field.properties === undefined
    ? withEnum
    : { ...withEnum, properties: normalizeFields(field.properties) };
}

function deepFreeze<T>(registry: T): T {
  for (const nested of Object.values(registry as Record<string, unknown>)) {
    if (nested !== null && typeof nested === 'object') deepFreeze(nested);
  }
  return Object.freeze(registry);
}

/** The op of this kind an adapter renders, or a thrown error naming the miss. */
export function findOp(registry: ResourceRegistry, kind: OpSpec['kind']): OpSpec {
  const operation = registry.ops.find((candidate) => candidate.kind === kind);
  if (operation === undefined) throw new Error(`unknown operation: ${registry.name}.${kind}`);
  return operation;
}

/** Field names in declaration order — flag parsing and schema properties need it. */
export function fieldNames(operation: OpSpec): string[] {
  return Object.keys(operation.fields);
}

export function fieldEntry(
  operation: OpSpec,
  fieldName: string,
): [string, FieldSpec] | undefined {
  const field = operation.fields[fieldName];
  return field === undefined ? undefined : [fieldName, field];
}
