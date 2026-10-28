/**
 * Validation/schema suite (SPEC.md §3, §7, §9.3): one accept/reject case table
 * runs against the core validator and against the JSON Schema the MCP adapter
 * advertises, and the two must return the same verdict for every case. The
 * schema can never drift from the validator without failing here.
 *
 * The case table exercises every `FieldSpec` type the sample registry declares
 * (string, number, boolean, string[]) plus the `number[]` type through a local
 * registry, required fields, unknown fields, and enums.
 */
import { defineResource, kindIsDestructive } from '../src/core/registry';
import { deriveInputSchema, type JsonSchema, type JsonSchemaProperty } from '../src/core/schema';
import { validateInput } from '../src/core/validate';
import { describeIssues } from '../src/core/validate';
import { fieldNames, findOp } from '../src/core/registry';
import { sampleRegistry } from '../src/fixtures/sample';
import type { OpSpec, ResourceRegistry } from '../src/core/types';
import { listTools } from '../src/mcp/tools';
import { parseCallCommand } from '../src/cli/parse';
import { service as notesService } from '../src/services/notes';

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

/** The `number[]` field the notes resource carries, on a one-op registry. */
const tagRegistry = defineResource({
  name: 'notes',
  basePath: '/notes',
  ops: [
    {
      kind: 'create',
      fields: {
        body: { type: 'string', required: true, description: 'Note body' },
        tagIds: { type: 'number[]', description: 'Tag ids to attach' },
      },
    },
  ],
});

/** The real notes registry (SPEC-ops-notes-service §1.1) — the module both adapters render. */
const notesRegistry = notesService.registry;

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
  { name: 'an empty tag id array', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [] }, accepted: true },
  { name: 'a two-element tag id array', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [1, 2] }, accepted: true },
  { name: 'a fractional tag id', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [1.5] }, accepted: true },
  { name: 'a mixed tag id array', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [1, '2'] }, accepted: false },
  { name: 'a NaN tag id', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [Number.NaN] }, accepted: false },
  { name: 'an infinite tag id', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: [Number.POSITIVE_INFINITY] }, accepted: false },
  { name: 'a bare tag id', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: 1 }, accepted: false },
  { name: 'a text tag id', registry: tagRegistry, kind: 'create', supplied: { body: 'a', tagIds: '1' }, accepted: false },
  {
    name: 'a two-element notes tag id array',
    registry: notesRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [1, 2] },
    accepted: true,
  },
  { name: 'a quoted notes tag id', registry: notesRegistry, kind: 'create', supplied: { body: 'a', tagIds: ['1'] }, accepted: false },
  { name: 'a bare notes tag id', registry: notesRegistry, kind: 'create', supplied: { body: 'a', tagIds: 1 }, accepted: false },
  { name: 'omitting the notes body', registry: notesRegistry, kind: 'create', supplied: { tagIds: [] }, accepted: false },
  { name: 'a notes get id', registry: notesRegistry, kind: 'get', supplied: { id: 'n1' }, accepted: true },
  { name: 'omitting the notes get id', registry: notesRegistry, kind: 'get', supplied: {}, accepted: false },
  { name: 'an empty notes list input', registry: notesRegistry, kind: 'list', supplied: {}, accepted: true },
  { name: 'a notes list filter page', registry: notesRegistry, kind: 'list', supplied: { tagId: 3, q: 'x', limit: 20, cursor: 'c1' }, accepted: true },
  { name: 'a quoted notes list limit', registry: notesRegistry, kind: 'list', supplied: { limit: '5' }, accepted: false },
  { name: 'a notes update id', registry: notesRegistry, kind: 'update', supplied: { id: 'n1', tagIds: [1] }, accepted: true },
  { name: 'omitting the notes update id', registry: notesRegistry, kind: 'update', supplied: { tagIds: [1] }, accepted: false },
  { name: 'a stale notes update version', registry: notesRegistry, kind: 'update', supplied: { id: 'n1', expectedVersion: 2 }, accepted: true },
  { name: 'a notes delete id', registry: notesRegistry, kind: 'delete', supplied: { id: 'n1' }, accepted: true },
  { name: 'omitting the notes delete id', registry: notesRegistry, kind: 'delete', supplied: {}, accepted: false },
  { name: 'a notes restore id', registry: notesRegistry, kind: 'restore', supplied: { id: 'n1' }, accepted: true },
  { name: 'omitting the notes restore id', registry: notesRegistry, kind: 'restore', supplied: {}, accepted: false },
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

  it('advertises number items for a number array field', () => {
    expect(deriveInputSchema(tagRegistry, 'create').properties['tagIds']).toEqual({
      type: 'array',
      items: { type: 'number' },
      description: 'Tag ids to attach',
    });
  });
});

describe('the canonical failure text', () => {
  it('names the field and the expected array type', () => {
    const operation = findOp(tagRegistry, 'create');
    const issues = validateInput(operation, { body: 'a', tagIds: [1, '2'] });

    expect(describeIssues('notes', 'create', issues)).toBe(
      'invalid input for notes.create: tagIds: expected number[]',
    );
  });
});

describe('the call flag parser', () => {
  it('turns a repeated numeric flag into a number array', () => {
    const call = parseCallCommand(['notes', 'create', '--body', 'a', '--tagIds', '1', '--tagIds', '2'], tagRegistry);

    expect(call.input['tagIds']).toEqual([1, 2]);
  });

  it('turns a single numeric flag occurrence into a one-element array', () => {
    const call = parseCallCommand(['notes', 'create', '--body', 'a', '--tagIds', '7'], tagRegistry);

    expect(call.input['tagIds']).toEqual([7]);
  });

  it('keeps repeated string flags a string array', () => {
    const call = parseCallCommand(['sample', 'create', '--title', 'a', '--labels', 'x', '--labels', 'y'], sampleRegistry);

    expect(call.input['labels']).toEqual(['x', 'y']);
  });

  it('converts a repeated non-numeric flag into a value the validator rejects', () => {
    const call = parseCallCommand(['notes', 'create', '--body', 'a', '--tagIds', 'one'], tagRegistry);
    const issues = validateInput(call.operation, call.input);

    expect(describeIssues('notes', 'create', issues)).toBe(
      'invalid input for notes.create: tagIds: expected number[]',
    );
  });
});

describe('the destructiveness flag', () => {
  // SPEC-ops-agent-contract §3.2, row by row over the closed kind set.
  const HINT_ROWS: Array<[
    OpSpec['kind'],
    { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean },
  ]> = [
    ['get', { readOnlyHint: true, destructiveHint: false, idempotentHint: true }],
    ['list', { readOnlyHint: true, destructiveHint: false, idempotentHint: true }],
    ['create', { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
    ['update', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
    ['delete', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ];

  for (const [kind, hints] of HINT_ROWS) {
    it(`reports the ${kind} row of the hint table`, () => {
      expect(kindIsDestructive(kind)).toBe(hints.destructiveHint);
      expect(annotationsOf(sampleRegistry, kind)).toEqual({ ...hints, openWorldHint: false });
    });
  }

  it('freezes the default onto every op of the registry', () => {
    expect(sampleRegistry.ops.map((operation) => operation.isDestructive)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('keeps the registry deep-frozen with the flag in place', () => {
    expect(Object.isFrozen(sampleRegistry.ops[0])).toBe(true);
    expect(Object.isFrozen(sampleRegistry.ops[0]?.fields)).toBe(true);
  });

  it('reports a mutating op the author called safe as non-destructive', () => {
    const safeRegistry = overriddenRegistry({ kind: 'delete', isDestructive: false });

    expect(annotationsOf(safeRegistry, 'delete').destructiveHint).toBe(false);
  });

  it('reports a read the author called destructive as destructive', () => {
    const armedRegistry = overriddenRegistry({ kind: 'get', isDestructive: true });

    expect(annotationsOf(armedRegistry, 'get').destructiveHint).toBe(true);
  });

  it('leaves name, description, and inputSchema untouched by the flag', () => {
    const tool = toolOf(sampleRegistry, 'delete');

    expect(tool.name).toBe('sample_delete');
    expect(tool.description).toBe('delete a sample record through /samples');
    expect(tool.inputSchema).toEqual(deriveInputSchema(sampleRegistry, 'delete'));
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

  it('titles every tool as "<Verb> <registry.name>"', () => {
    expect(listTools(sampleRegistry).map((tool) => tool.title)).toEqual([
      'Create sample',
      'Get sample',
      'List sample',
      'Update sample',
      'Delete sample',
    ]);
  });

  it('states all four hints on every tool', () => {
    for (const tool of listTools(sampleRegistry)) {
      expect(Object.keys(tool.annotations).sort()).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });

  it('declares no outputSchema, since the registry models requests only', () => {
    for (const tool of listTools(sampleRegistry)) {
      expect(tool).not.toHaveProperty('outputSchema');
    }
  });
});

/** The closed `tools/list` surface the notes registry must project, in registry order. */
const NOTES_TOOL_ROWS: Array<[string, string]> = [
  ['notes_create', 'Create notes'],
  ['notes_get', 'Get notes'],
  ['notes_list', 'List notes'],
  ['notes_update', 'Update notes'],
  ['notes_delete', 'Delete notes'],
  ['notes_restore', 'Restore notes'],
];

/** The read kinds, whose hints every other kind inverts (SPEC-ops-agent-contract §3.2). */
const READ_ONLY_KINDS: OpSpec['kind'][] = ['get', 'list'];

/** Each notes op with the required fields the registry declares for it. */
const NOTES_REQUIRED_ROWS: Array<[OpSpec['kind'], string[]]> = [
  ['create', ['body']],
  ['get', ['id']],
  ['list', []],
  ['update', ['id']],
  ['delete', ['id']],
  ['restore', ['id']],
];

describe('the notes tool surface', () => {
  it('names and titles the six notes tools in registry order', () => {
    expect(listTools(notesRegistry).map((tool) => [tool.name, tool.title])).toEqual(NOTES_TOOL_ROWS);
  });

  it('marks the read kinds read-only and non-destructive', () => {
    const tools = listTools(notesRegistry).filter((tool) => isReadTool(tool.name));

    expect(tools.map((tool) => [tool.annotations.readOnlyHint, tool.annotations.destructiveHint])).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it('marks every writing kind non-read-only and destructive', () => {
    const tools = listTools(notesRegistry).filter((tool) => !isReadTool(tool.name));

    expect(tools.map((tool) => [tool.annotations.readOnlyHint, tool.annotations.destructiveHint])).toEqual([
      [false, true],
      [false, true],
      [false, true],
      [false, true],
    ]);
  });

  it('closes the world for every notes tool', () => {
    expect(listTools(notesRegistry).every((tool) => tool.annotations.openWorldHint === false)).toBe(true);
  });

  it('advertises number tag ids wherever the registry declares them', () => {
    for (const kind of ['create', 'update'] as const) {
      expect(deriveInputSchema(notesRegistry, kind).properties['tagIds']).toMatchObject({
        type: 'array',
        items: { type: 'number' },
      });
    }
  });

  for (const [kind, required] of NOTES_REQUIRED_ROWS) {
    it(`advertises the registry required fields for notes ${kind}`, () => {
      expect(deriveInputSchema(notesRegistry, kind).required).toEqual(required);
    });
  }
});

/** True when the tool's kind is a read, read off the hint the projection stamped. */
function isReadTool(toolName: string): boolean {
  const kind = toolName.replace('notes_', '') as OpSpec['kind'];
  return READ_ONLY_KINDS.includes(kind);
}

/** A one-op registry carrying an explicit `isDestructive`, for the override cases. */
function overriddenRegistry(operation: {
  kind: OpSpec['kind'];
  isDestructive: boolean;
}): ResourceRegistry {
  return defineResource({
    name: 'sample',
    basePath: '/samples',
    ops: [{ kind: operation.kind, isDestructive: operation.isDestructive, fields: {} }],
  });
}

function toolOf(registry: ResourceRegistry, kind: OpSpec['kind']) {
  const tool = listTools(registry).find((candidate) => candidate.name === `sample_${kind}`);
  if (tool === undefined) throw new Error(`no tool for ${kind}`);
  return tool;
}

function annotationsOf(registry: ResourceRegistry, kind: OpSpec['kind']) {
  return toolOf(registry, kind).annotations;
}

/** True when `supplied` passes `schema` — the same judgement the validator makes. */
function accepts(schema: JsonSchema, supplied: Record<string, unknown>): boolean {
  if (schema.required.some((name) => supplied[name] === undefined)) return false;
  return Object.entries(supplied).every(([name, value]) => declares(schema, name) && matches(schema.properties[name], value));
}

function declares(schema: JsonSchema, name: string): boolean {
  if (name in schema.properties) return true;
  return schema.additionalProperties !== false;
}

function matches(property: JsonSchemaProperty, value: unknown): boolean {
  if (value === undefined) return true;
  if (!hasType(property, value)) return false;
  return property.enum === undefined || property.enum.includes(value as string);
}

function hasType(property: JsonSchemaProperty, value: unknown): boolean {
  if (property.type === 'array') return hasItemType(property.items?.type, value);
  if (property.type === 'number') return isFiniteNumber(value);
  return typeof value === property.type;
}

function hasItemType(itemType: 'string' | 'number' | undefined, value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (itemType === 'number') return value.every(isFiniteNumber);
  return value.every((entry) => typeof entry === 'string');
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
