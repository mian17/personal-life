/**
 * Validation/schema suite (SPEC.md §3, §7, §9.3): one accept/reject case table
 * runs against the core validator and against the JSON Schema the MCP adapter
 * advertises, and the two must return the same verdict for every case. The
 * schema can never drift from the validator without failing here.
 *
 * The case table exercises every `FieldSpec` type the sample registry declares
 * (string, number, boolean, string[]) plus required fields, unknown fields, and
 * enums — the last through a local registry, since the sample declares no enum.
 */
import { defineResource } from '../src/core/registry';
import { deriveInputSchema, type JsonSchema } from '../src/core/schema';
import { validateInput } from '../src/core/validate';
import { fieldNames, findOp } from '../src/core/registry';
import { sampleRegistry } from '../src/fixtures/sample';
import type { OpSpec, ResourceRegistry } from '../src/core/types';
import { listTools } from '../src/mcp/tools';

interface Case {
  name: string;
  registry: ResourceRegistry;
  kind: OpSpec['kind'];
  supplied: Record<string, unknown>;
  accepted: boolean;
}

const enumRegistry = defineResource({
  name: 'sample',
  basePath: '/samples',
  ops: [
    {
      kind: 'create',
      fields: {
        title: { type: 'string', required: true, description: 'Title' },
        status: { type: 'string', enum: ['draft', 'live'], description: 'Lifecycle status' },
      },
    },
  ],
});

const CASES: Case[] = [
  {
    name: 'a complete create',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', priority: 1, archived: false, labels: ['x'] },
    accepted: true,
  },
  { name: 'an omitted create title', registry: sampleRegistry, kind: 'create', supplied: { priority: 1 }, accepted: false },
  { name: 'an optional create priority', registry: sampleRegistry, kind: 'create', supplied: { title: 'a' }, accepted: true },
  { name: 'a numeric string priority', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', priority: '1' }, accepted: false },
  { name: 'an infinite priority', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', priority: Number.POSITIVE_INFINITY }, accepted: false },
  { name: 'a boolean archived', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', archived: true }, accepted: true },
  { name: 'a string archived', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', archived: 'yes' }, accepted: false },
  { name: 'a string array labels', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', labels: ['x', 'y'] }, accepted: true },
  { name: 'an empty label array', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', labels: [] }, accepted: true },
  { name: 'a mixed label array', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', labels: ['x', 1] }, accepted: false },
  { name: 'a bare label value', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', labels: 'x' }, accepted: false },
  { name: 'an undeclared create field', registry: sampleRegistry, kind: 'create', supplied: { title: 'a', bogus: 1 }, accepted: false },
  { name: 'a required get id', registry: sampleRegistry, kind: 'get', supplied: { id: 'r1' }, accepted: true },
  { name: 'a missing get id', registry: sampleRegistry, kind: 'get', supplied: {}, accepted: false },
  { name: 'a numeric list limit', registry: sampleRegistry, kind: 'list', supplied: { limit: 5 }, accepted: true },
  { name: 'a string list limit', registry: sampleRegistry, kind: 'list', supplied: { limit: 'five' }, accepted: false },
  { name: 'a boolean list flag', registry: sampleRegistry, kind: 'list', supplied: { includeArchived: true }, accepted: true },
  { name: 'a string list flag', registry: sampleRegistry, kind: 'list', supplied: { includeArchived: 'yes' }, accepted: false },
  { name: 'an update version', registry: sampleRegistry, kind: 'update', supplied: { id: 'r1', expectedVersion: 2 }, accepted: true },
  { name: 'a string update version', registry: sampleRegistry, kind: 'update', supplied: { id: 'r1', expectedVersion: '2' }, accepted: false },
  { name: 'a declared enum value', registry: enumRegistry, kind: 'create', supplied: { title: 'a', status: 'draft' }, accepted: true },
  { name: 'an undeclared enum value', registry: enumRegistry, kind: 'create', supplied: { title: 'a', status: 'gone' }, accepted: false },
];

describe('the shared case table', () => {
  for (const testCase of CASES) {
    it(`verdict keeps validator and schema agreement for ${testCase.name}`, () => {
      const operation = findOp(testCase.registry, testCase.kind);
      const issues = validateInput(operation, testCase.supplied);
      const schema = deriveInputSchema(testCase.registry, testCase.kind);

      expect(issues.length === 0).toBe(testCase.accepted);
      expect(accepts(schema, testCase.supplied)).toBe(testCase.accepted);
    });
  }
});

describe('the derived schema', () => {
  it('rejects undeclared fields', () => {
    expect(deriveInputSchema(sampleRegistry, 'create').additionalProperties).toBe(false);
  });

  it('advertises one property per declared field', () => {
    const operation = findOp(sampleRegistry, 'create');

    expect(Object.keys(deriveInputSchema(sampleRegistry, 'create').properties)).toEqual(
      fieldNames(operation),
    );
  });

  it('carries the field description and the array item type', () => {
    const schema = deriveInputSchema(sampleRegistry, 'create');

    expect(schema.properties['labels']).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'Free-form labels attached at creation',
    });
  });

  it('carries the enum beside the field type', () => {
    expect(deriveInputSchema(enumRegistry, 'create').properties['status']).toEqual({
      type: 'string',
      enum: ['draft', 'live'],
      description: 'Lifecycle status',
    });
  });
});

describe('the MCP tool surface', () => {
  it('names one tool per registry op', () => {
    expect(listTools(sampleRegistry).map((tool) => tool.name)).toEqual([
      'sample_create',
      'sample_get',
      'sample_list',
      'sample_update',
      'sample_delete',
    ]);
  });

  it('advertises the schema the validator agrees with', () => {
    for (const tool of listTools(sampleRegistry)) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });
});

/** True when `supplied` passes `schema` — the same judgement the validator makes. */
function accepts(schema: JsonSchema, supplied: Record<string, unknown>): boolean {
  if (schema.required.some((name) => supplied[name] === undefined)) return false;
  return Object.entries(supplied).every(([name, value]) => declares(schema, name) && matches(schema.properties[name], value));
}

function declares(schema: JsonSchema, name: string): boolean {
  if (name in schema.properties) return true;
  return schema.additionalProperties !== false;
}

function matches(property: { type: string; items?: { type: 'string' }; enum?: readonly string[] }, value: unknown): boolean {
  if (value === undefined) return true;
  if (!hasType(property.type, value)) return false;
  return property.enum === undefined || property.enum.includes(value as string);
}

function hasType(type: string, value: unknown): boolean {
  if (type === 'array') return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
