/**
 * `life-ops` argument parsing (SPEC.md §3): `life-ops <resource> <op> [flags]`
 * plus the `login`/`logout` commands. Flags derive from the op's field specs, so
 * registering a new op needs no parser change. The parser shapes values; it never
 * decides whether they are valid — `core/validate` owns accept/reject (DRY rule).
 * A nested field (`object`, `object[]`) takes its value as JSON text, so the CLI
 * expresses exactly what an MCP object argument carries (SPEC-ops-all-services §1.1.1).
 * A bulk op takes one `--items` per submitted item, and its kind resolves in either
 * the camelCase or the kebab spelling (SPEC-bulk-ops §2.8). `--items` carries one id
 * string per occurrence and no JSON array, so an array value is refused before any
 * request exists rather than becoming one id that merely looks like a batch.
 */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { bulkItemInput, isBulkKind, type BulkKind } from '../core/bulk.js';
import type { FieldSpec, OpSpec, ResourceRegistry } from '../core/types.js';
import { BULK_WRAPPER_FIELD } from '../core/validate.js';
import { ADDRESSING_FIELD } from '../core/wire.js';
import { fieldNames, findOp } from '../core/registry.js';
import { invalidInputError, operationLabel } from '../transport/errors.js';

/** A bulk op once its kind is narrowed, so every item it submits has a known shape. */
type BulkOperation = OpSpec & { kind: BulkKind };

/** The call one `life-ops <resource> <op> [flags]` names, before the executor runs it. */
export interface OperationCall {
  operation: OpSpec;
  input: Record<string, unknown>;
}

/** The command head: `login`, `logout`, or a resource call that needs a registry. */
export function commandName(argv: string[]): 'login' | 'logout' | 'call' {
  const [command] = argv;
  if (command === 'login' || command === 'logout') return command;
  return 'call';
}

/** Reads the call arguments against the registry; an unknown resource or op fails here. */
export function parseCallCommand(argv: string[], registry: ResourceRegistry): OperationCall {
  const [resourceName, kind, ...flags] = argv;
  if (resourceName !== registry.name)
    throw new Error(`unknown resource: ${resourceName ?? '(none)'}`);
  const operation = operationNamed(registry, kind);
  return { operation, input: flagsToInput(registry, operation, flags) };
}

/** The op the argv names; a spelling no kind declares reaches `findOp`, which reports it. */
function operationNamed(registry: ResourceRegistry, spelling: string | undefined): OpSpec {
  return findOp(registry, declaredKindNamed(registry, spelling));
}

/** An op resolves by its kebab spelling too; a spelling no kind matches travels on to `findOp` unchanged. */
function declaredKindNamed(
  registry: ResourceRegistry,
  spelling: string | undefined,
): OpSpec['kind'] {
  const declared = registry.ops
    .map((operation) => operation.kind)
    .find((kind) => kebabName(kind) === spelling);
  return (declared ?? spelling) as OpSpec['kind'];
}

function flagsToInput(
  registry: ResourceRegistry,
  operation: OpSpec,
  flags: string[],
): Record<string, unknown> {
  const { values } = parseArgs({
    args: flags,
    options: optionSpecs(operation),
    strict: true,
    allowPositionals: false,
  });
  if (isBulkKind(operation.kind)) {
    return batchInput(registry, { ...operation, kind: operation.kind }, values[BULK_WRAPPER_FIELD]);
  }
  return convertValues(operation, values);
}

/** One `--items` occurrence per submitted item, in the order typed. */
function batchInput(
  registry: ResourceRegistry,
  operation: BulkOperation,
  occurrences: unknown,
): Record<string, unknown> {
  const items = occurrenceTexts(occurrences).map((text) =>
    submittedItem(registry, operation, text),
  );
  return { [BULK_WRAPPER_FIELD]: items };
}

function occurrenceTexts(occurrences: unknown): string[] {
  if (occurrences === undefined) return [];
  const repeated = Array.isArray(occurrences) ? occurrences : [occurrences];
  return repeated.map(String);
}

/** A bare id is shaped like its own field; a payload item is the JSON object the flag carries. */
function submittedItem(
  registry: ResourceRegistry,
  operation: BulkOperation,
  text: string,
): unknown {
  if (!itemIsBareId(operation)) return toJsonValue(text);
  return submittedId(registry, operation, text);
}

/** One id string per flag, converted as its field declares; a JSON array of ids is refused (§2.8). */
function submittedId(registry: ResourceRegistry, operation: BulkOperation, text: string): unknown {
  if (Array.isArray(toJsonValue(text))) throw jsonArrayItemsError(registry, operation);
  return toInputValue(operation.fields[ADDRESSING_FIELD], text);
}

/**
 * The refusal an array-valued `--items` takes: the canonical invalid-input rendering both
 * adapters print, naming the flag and the one thing it accepts, because a batch is spelled
 * by repeating the flag — never by an array the CLI would have to unwrap.
 */
function jsonArrayItemsError(registry: ResourceRegistry, operation: BulkOperation): Error {
  return invalidInputError(operationLabel(registry, operation.kind), [
    {
      field: BULK_WRAPPER_FIELD,
      reason:
        '--items takes one id string per flag, not a JSON array; repeat the flag once per item',
    },
  ]);
}

/** `bulkItemInput` wraps a bare id under the addressing field and passes a payload object through. */
function itemIsBareId(operation: BulkOperation): boolean {
  return ADDRESSING_FIELD in bulkItemInput(operation.kind, {});
}

/** A bulk op takes `--items` alone; every other op takes one option per field spec. */
function optionSpecs(operation: OpSpec): ParseArgsOptionsConfig {
  if (isBulkKind(operation.kind)) return { [BULK_WRAPPER_FIELD]: repeatedText() };
  const specs: ParseArgsOptionsConfig = {};
  for (const fieldName of fieldNames(operation)) {
    const option = optionFor(operation.fields[fieldName]);
    specs[fieldName] = option;
    const kebab = kebabName(fieldName);
    if (kebab !== fieldName) specs[kebab] = option;
  }
  return specs;
}

/** Text carrying one value per occurrence: every array field, and `--items`. */
function repeatedText(): { type: 'string'; multiple: true } {
  return { type: 'string', multiple: true };
}

/**
 * Users type flags and op kinds in kebab case (`--expected-version`,
 * `notes get-many`), while the registry keeps its camelCase names; the camelCase
 * spelling stays accepted because `SPEC-ops-notes-service.md` documents `--tagIds`.
 */
function kebabName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The registry field a parsed flag names, whichever spelling reached `parseArgs`. */
function fieldNameFor(operation: OpSpec, flagName: string): string {
  return fieldNames(operation).find((name) => kebabName(name) === flagName) ?? flagName;
}

function optionFor(field: FieldSpec): { type: 'string' | 'boolean'; multiple?: boolean } {
  if (field.type === 'boolean') return { type: 'boolean' };
  if (field.type === 'string[]' || field.type === 'number[]') return repeatedText();
  return { type: 'string' };
}

function convertValues(
  operation: OpSpec,
  values: Record<string, string | boolean | (string | boolean)[] | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([flagName, value]) => {
      if (value === undefined) return [];
      const fieldName = fieldNameFor(operation, flagName);
      return [[fieldName, toInputValue(operation.fields[fieldName], value)]];
    }),
  );
}

/**
 * `parseArgs` yields numbers as text and array fields as text lists; the core
 * validator rejects a non-numeric entry either way.
 */
function toInputValue(field: FieldSpec | undefined, value: unknown): unknown {
  if (field?.type === 'number') return Number(value);
  if (field?.type === 'number[]') return toNumberArray(value);
  if (isNestedType(field?.type)) return toJsonValue(value);
  return value;
}

/**
 * A nested flag and a payload batch item carry JSON text: `--nutrients '{"calories":400}'`,
 * `--items '{"id":"n1"}'`. Text that does not parse travels on as its own string, so the
 * validator rejects it as `expected object` — one canonical failure shape for the CLI and
 * the MCP adapter, never a `SyntaxError`.
 */
function toJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isNestedType(type: FieldSpec['type'] | undefined): boolean {
  return type === 'object' || type === 'object[]';
}

function toNumberArray(value: unknown): unknown[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.map(Number);
}
