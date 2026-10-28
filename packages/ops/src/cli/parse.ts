/**
 * `life-ops` argument parsing (SPEC.md §3): `life-ops <resource> <op> [flags]`
 * plus the `login`/`logout` commands. Flags derive from the op's field specs, so
 * registering a new op needs no parser change. The parser shapes values; it never
 * decides whether they are valid — `core/validate` owns accept/reject (DRY rule).
 */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { FieldSpec, OpSpec, ResourceRegistry } from '../core/types';
import { fieldNames, findOp } from '../core/registry';

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
  if (resourceName !== registry.name) throw new Error(`unknown resource: ${resourceName ?? '(none)'}`);
  const operation = operationNamed(registry, kind);
  return { operation, input: flagsToInput(operation, flags) };
}

/** The op the registry itself declares; kind resolution lives in core/registry, not here. */
function operationNamed(registry: ResourceRegistry, kind: string | undefined): OpSpec {
  return findOp(registry, kind as OpSpec['kind']);
}

function flagsToInput(operation: OpSpec, flags: string[]): Record<string, unknown> {
  const { values } = parseArgs({
    args: flags,
    options: optionSpecs(operation),
    strict: true,
    allowPositionals: false,
  });
  return convertValues(operation, values);
}

/** One option per field spec: booleans flag, arrays repeat, numbers arrive as text. */
function optionSpecs(operation: OpSpec): ParseArgsOptionsConfig {
  return Object.fromEntries(
    fieldNames(operation).map((fieldName) => [fieldName, optionFor(operation.fields[fieldName])]),
  );
}

function optionFor(field: FieldSpec): { type: 'string' | 'boolean'; multiple?: boolean } {
  if (field.type === 'boolean') return { type: 'boolean' };
  if (field.type === 'string[]' || field.type === 'number[]') return { type: 'string', multiple: true };
  return { type: 'string' };
}

function convertValues(
  operation: OpSpec,
  values: Record<string, string | boolean | (string | boolean)[] | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([fieldName, value]) =>
      value === undefined ? [] : [[fieldName, toInputValue(operation.fields[fieldName], value)]],
    ),
  );
}

/**
 * `parseArgs` yields numbers as text and array fields as text lists; the core
 * validator rejects a non-numeric entry either way.
 */
function toInputValue(field: FieldSpec | undefined, value: unknown): unknown {
  if (field?.type === 'number') return Number(value);
  if (field?.type === 'number[]') return toNumberArray(value);
  return value;
}

function toNumberArray(value: unknown): unknown[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => Number(entry));
}
