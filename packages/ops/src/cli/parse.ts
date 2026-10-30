/**
 * `life-ops` argument parsing (SPEC.md §3): `life-ops <resource> <op> [flags]`
 * plus the `login`/`logout` commands. Flags derive from the op's field specs, so
 * registering a new op needs no parser change. The parser shapes values; it never
 * decides whether they are valid — `core/validate` owns accept/reject (DRY rule).
 * A nested field (`object`, `object[]`) takes its value as JSON text, so the CLI
 * expresses exactly what an MCP object argument carries (SPEC-ops-all-services §1.1.1).
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
  const specs: ParseArgsOptionsConfig = {};
  for (const fieldName of fieldNames(operation)) {
    const option = optionFor(operation.fields[fieldName]);
    specs[fieldName] = option;
    const kebab = kebabName(fieldName);
    if (kebab !== fieldName) specs[kebab] = option;
  }
  return specs;
}

/**
 * Users type CLI flags in kebab case (`--expected-version`), while the registry
 * field keeps its camelCase name; the camelCase spelling stays accepted because
 * `SPEC-ops-notes-service.md` documents `--tagIds`.
 */
function kebabName(fieldName: string): string {
  return fieldName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The registry field a parsed flag names, whichever spelling reached `parseArgs`. */
function fieldNameFor(operation: OpSpec, flagName: string): string {
  return fieldNames(operation).find((name) => kebabName(name) === flagName) ?? flagName;
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
 * A nested flag carries JSON text: `--nutrients '{"calories":400}'`. Text that does not
 * parse travels on as its own string, so the validator rejects it as `expected object`
 * — one canonical failure shape for the CLI and the MCP adapter, never a `SyntaxError`.
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
  return entries.map((entry) => Number(entry));
}
