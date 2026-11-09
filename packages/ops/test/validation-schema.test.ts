/**
 * Validation/schema suite (SPEC.md §3, §7, §9.3): one accept/reject case table
 * runs against the core validator and against the JSON Schema the MCP adapter
 * advertises, and the two must return the same verdict for every case. The
 * schema can never drift from the validator without failing here.
 *
 * The case table exercises every `FieldSpec` type the sample registry declares
 * (string, number, boolean, string[]) plus the `number[]` type through a local
 * registry, and both nested types through the saved-meals table: required
 * fields, unknown fields, enums, nested required keys, nested unknown keys, and
 * two-level nesting. The schema judgement lives in `support/schema-accepts.ts`
 * and recurses, so nested drift is a failure rather than an unchecked region.
 */
import { defineResource, kindIsDestructive } from '../src/core/registry.js';
import { deriveInputSchema } from '../src/core/schema.js';
import { shapeProblems, validateInput } from '../src/core/validate.js';
import { describeIssues } from '../src/core/validate.js';
import { fieldNames, findOp } from '../src/core/registry.js';
import { sampleRegistry } from '../src/fixtures/sample.js';
import type { FieldSpec, OpSpec, ResourceRegistry } from '../src/core/types.js';
import { listTools } from '../src/mcp/tools.js';
import { parseCallCommand } from '../src/cli/parse.js';
import { wireFor } from '../src/core/wire.js';
import { service as notesService } from '../src/services/notes.js';
import { accepts } from './support/schema-accepts.js';

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

/** The 27 nutrient keys of SPEC-ops-all-services §1.3, in `NUTRIENTS` order. */
const NUTRIENT_KEYS = [
  'calories',
  'fat',
  'monounsaturatedFat',
  'polyunsaturatedFat',
  'saturatedFat',
  'transFat',
  'cholesterol',
  'sodium',
  'carbohydrates',
  'fiber',
  'sugar',
  'protein',
  'vitaminA',
  'vitaminC',
  'thiaminB1',
  'riboflavinB2',
  'niacinB3',
  'folateB9',
  'vitaminB6',
  'vitaminB12',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'caffeine',
] as const;

const nutrientProperties: Record<string, FieldSpec> = Object.fromEntries(
  NUTRIENT_KEYS.map((key) => [
    key,
    { type: 'number' as const, required: true, description: `Amount of ${key}` },
  ]),
);

/** A full 27-key nutrient vector, for the accepted nested cases. */
const nutrientVector: Record<string, number> = Object.fromEntries(
  NUTRIENT_KEYS.map((key) => [key, 1]),
);

/**
 * The field table of the saved-meals `create` op (SPEC-ops-all-services §1.3),
 * carrying the two nested types §1.1.1 adds. Kept as a raw table, without a
 * `defineResource` round trip, so the nested cases below judge the validator and the
 * shape guard directly; `meal-parity.test.ts` covers the same tables through the registry.
 */
const mealFields: Record<string, FieldSpec> = {
  name: { type: 'string', required: true, description: 'Saved meal name' },
  nutrients: {
    type: 'object',
    required: true,
    properties: nutrientProperties,
    description: 'Nutrient vector (27 known keys)',
  },
  portions: {
    type: 'object[]',
    description: 'Portions of one food',
    properties: {
      label: { type: 'string', required: true, description: 'Portion label' },
      amount: { type: 'number', required: true, description: 'Amount in the food unit' },
    },
  },
  items: {
    type: 'object[]',
    description: 'Foods the saved meal holds',
    properties: {
      foodId: { type: 'string', required: true, description: 'Food identifier' },
      quantity: { type: 'number', required: true, description: 'Amount in the food unit' },
      nutrients: {
        type: 'object',
        required: true,
        properties: nutrientProperties,
        description: 'Nutrient vector of this item',
      },
    },
  },
};

/** One `create` op over the nested table — the descriptor the validator reads. */
const mealOperation: OpSpec = {
  kind: 'create',
  fields: mealFields,
  isDestructive: true,
};

/** The same nested op as a registry, so the case table's schema half can read it. */
const mealRegistry: ResourceRegistry = {
  name: 'saved-meals',
  basePath: '/api/saved-meals',
  ops: [mealOperation],
};

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
  {
    name: 'an omitted create title',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { priority: 1 },
    accepted: false,
  },
  {
    name: 'an optional create priority',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a' },
    accepted: true,
  },
  {
    name: 'a numeric string priority',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', priority: '1' },
    accepted: false,
  },
  {
    name: 'an infinite priority',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', priority: Number.POSITIVE_INFINITY },
    accepted: false,
  },
  {
    name: 'a boolean archived',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', archived: true },
    accepted: true,
  },
  {
    name: 'a string archived',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', archived: 'yes' },
    accepted: false,
  },
  {
    name: 'a string array labels',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', labels: ['x', 'y'] },
    accepted: true,
  },
  {
    name: 'an empty label array',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', labels: [] },
    accepted: true,
  },
  {
    name: 'a mixed label array',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', labels: ['x', 1] },
    accepted: false,
  },
  {
    name: 'a bare label value',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', labels: 'x' },
    accepted: false,
  },
  {
    name: 'an undeclared create field',
    registry: sampleRegistry,
    kind: 'create',
    supplied: { title: 'a', bogus: 1 },
    accepted: false,
  },
  {
    name: 'a required get id',
    registry: sampleRegistry,
    kind: 'get',
    supplied: { id: 'r1' },
    accepted: true,
  },
  {
    name: 'a missing get id',
    registry: sampleRegistry,
    kind: 'get',
    supplied: {},
    accepted: false,
  },
  {
    name: 'a numeric list limit',
    registry: sampleRegistry,
    kind: 'list',
    supplied: { limit: 5 },
    accepted: true,
  },
  {
    name: 'a string list limit',
    registry: sampleRegistry,
    kind: 'list',
    supplied: { limit: 'five' },
    accepted: false,
  },
  {
    name: 'a boolean list flag',
    registry: sampleRegistry,
    kind: 'list',
    supplied: { includeArchived: true },
    accepted: true,
  },
  {
    name: 'a string list flag',
    registry: sampleRegistry,
    kind: 'list',
    supplied: { includeArchived: 'yes' },
    accepted: false,
  },
  {
    name: 'an update version',
    registry: sampleRegistry,
    kind: 'update',
    supplied: { id: 'r1', expectedVersion: 2 },
    accepted: true,
  },
  {
    name: 'a string update version',
    registry: sampleRegistry,
    kind: 'update',
    supplied: { id: 'r1', expectedVersion: '2' },
    accepted: false,
  },
  {
    name: 'a declared enum value',
    registry: enumRegistry,
    kind: 'create',
    supplied: { title: 'a', status: 'draft' },
    accepted: true,
  },
  {
    name: 'an undeclared enum value',
    registry: enumRegistry,
    kind: 'create',
    supplied: { title: 'a', status: 'gone' },
    accepted: false,
  },
  {
    name: 'an empty tag id array',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [] },
    accepted: true,
  },
  {
    name: 'a two-element tag id array',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [1, 2] },
    accepted: true,
  },
  {
    name: 'a fractional tag id',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [1.5] },
    accepted: true,
  },
  {
    name: 'a mixed tag id array',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [1, '2'] },
    accepted: false,
  },
  {
    name: 'a NaN tag id',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [Number.NaN] },
    accepted: false,
  },
  {
    name: 'an infinite tag id',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [Number.POSITIVE_INFINITY] },
    accepted: false,
  },
  {
    name: 'a bare tag id',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: 1 },
    accepted: false,
  },
  {
    name: 'a text tag id',
    registry: tagRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: '1' },
    accepted: false,
  },
  {
    name: 'a two-element notes tag id array',
    registry: notesRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: [1, 2] },
    accepted: true,
  },
  {
    name: 'a quoted notes tag id',
    registry: notesRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: ['1'] },
    accepted: false,
  },
  {
    name: 'a bare notes tag id',
    registry: notesRegistry,
    kind: 'create',
    supplied: { body: 'a', tagIds: 1 },
    accepted: false,
  },
  {
    name: 'omitting the notes body',
    registry: notesRegistry,
    kind: 'create',
    supplied: { tagIds: [] },
    accepted: false,
  },
  {
    name: 'a notes get id',
    registry: notesRegistry,
    kind: 'get',
    supplied: { id: 'n1' },
    accepted: true,
  },
  {
    name: 'omitting the notes get id',
    registry: notesRegistry,
    kind: 'get',
    supplied: {},
    accepted: false,
  },
  {
    name: 'an empty notes list input',
    registry: notesRegistry,
    kind: 'list',
    supplied: {},
    accepted: true,
  },
  {
    name: 'a notes list filter page',
    registry: notesRegistry,
    kind: 'list',
    supplied: { tagId: 3, q: 'x', limit: 20, cursor: 'c1' },
    accepted: true,
  },
  {
    name: 'a quoted notes list limit',
    registry: notesRegistry,
    kind: 'list',
    supplied: { limit: '5' },
    accepted: false,
  },
  {
    name: 'a notes update id',
    registry: notesRegistry,
    kind: 'update',
    supplied: { id: 'n1', tagIds: [1] },
    accepted: true,
  },
  {
    name: 'omitting the notes update id',
    registry: notesRegistry,
    kind: 'update',
    supplied: { tagIds: [1] },
    accepted: false,
  },
  {
    name: 'a stale notes update version',
    registry: notesRegistry,
    kind: 'update',
    supplied: { id: 'n1', expectedVersion: 2 },
    accepted: true,
  },
  {
    name: 'a notes delete id',
    registry: notesRegistry,
    kind: 'delete',
    supplied: { id: 'n1' },
    accepted: true,
  },
  {
    name: 'omitting the notes delete id',
    registry: notesRegistry,
    kind: 'delete',
    supplied: {},
    accepted: false,
  },
  {
    name: 'a notes restore id',
    registry: notesRegistry,
    kind: 'restore',
    supplied: { id: 'n1' },
    accepted: true,
  },
  {
    name: 'omitting the notes restore id',
    registry: notesRegistry,
    kind: 'restore',
    supplied: {},
    accepted: false,
  },
  {
    name: 'a complete nested meal',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: nutrientVector, portions: [{ label: 'half', amount: 2 }] },
    accepted: true,
  },
  {
    name: 'a text nutrient amount',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: { ...nutrientVector, sodium: 'lots' } },
    accepted: false,
  },
  {
    name: 'an undeclared nutrient key',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: { ...nutrientVector, sodiumX: 1 } },
    accepted: false,
  },
  {
    name: 'a nutrient vector missing a required key',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: { calories: 400 } },
    accepted: false,
  },
  {
    name: 'an omitted nested nutrient vector',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a' },
    accepted: false,
  },
  {
    name: 'a non-object portion element',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: nutrientVector, portions: ['half'] },
    accepted: false,
  },
  {
    name: 'a portion element missing its required amount',
    registry: mealRegistry,
    kind: 'create',
    supplied: { name: 'a', nutrients: nutrientVector, portions: [{ label: 'half' }] },
    accepted: false,
  },
  {
    name: 'an undeclared portion key',
    registry: mealRegistry,
    kind: 'create',
    supplied: {
      name: 'a',
      nutrients: nutrientVector,
      portions: [{ label: 'half', amount: 2, unit: 'g' }],
    },
    accepted: false,
  },
  {
    name: 'a nested nutrient failure two levels down',
    registry: mealRegistry,
    kind: 'create',
    supplied: {
      name: 'a',
      nutrients: nutrientVector,
      items: [{ foodId: 'f1', quantity: 2, nutrients: { ...nutrientVector, sodium: 'lots' } }],
    },
    accepted: false,
  },
  {
    name: 'a nested nutrient vector two levels down',
    registry: mealRegistry,
    kind: 'create',
    supplied: {
      name: 'a',
      nutrients: nutrientVector,
      items: [{ foodId: 'f1', quantity: 2, nutrients: nutrientVector }],
    },
    accepted: true,
  },
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

describe('the nested field paths', () => {
  it('names the unknown nutrient by its dotted path', () => {
    const issues = validateInput(mealOperation, {
      name: 'a',
      nutrients: { ...nutrientVector, sodiumX: 1 },
    });

    expect(describeIssues('saved-meals', 'create', issues)).toBe(
      'invalid input for saved-meals.create: nutrients.sodiumX: unknown field',
    );
  });

  it('names the omitted nutrient by its dotted path', () => {
    const issues = validateInput(mealOperation, { name: 'a', nutrients: { calories: 400 } });

    expect(issues).toContainEqual({ field: 'nutrients.sodium', reason: 'required' });
  });

  it('reports a two-level failure at items.0.nutrients.sodium', () => {
    const issues = validateInput(mealOperation, {
      name: 'a',
      nutrients: nutrientVector,
      items: [{ foodId: 'f1', quantity: 2, nutrients: { ...nutrientVector, sodium: 'lots' } }],
    });

    expect(issues).toEqual([{ field: 'items.0.nutrients.sodium', reason: 'expected number' }]);
  });

  it('reports a non-object array element by its index', () => {
    const issues = validateInput(mealOperation, {
      name: 'a',
      nutrients: nutrientVector,
      portions: ['half'],
    });

    expect(issues).toEqual([{ field: 'portions.0', reason: 'expected object' }]);
  });

  it('reports a missing required property of one array element', () => {
    const issues = validateInput(mealOperation, {
      name: 'a',
      nutrients: nutrientVector,
      portions: [{ label: 'half' }],
    });

    expect(issues).toEqual([{ field: 'portions.0.amount', reason: 'required' }]);
  });
});

describe('the descriptor shape guard', () => {
  it('accepts the nested declaration table', () => {
    expect(shapeProblems(mealOperation)).toEqual([]);
  });

  it('names a nested field that declares no properties', () => {
    expect(
      shapeProblems(operationOver({ nutrients: { type: 'object', description: 'Nutrients' } })),
    ).toEqual(['nutrients: object without properties']);
  });

  it('names a flat field that declares properties', () => {
    expect(
      shapeProblems(
        operationOver({
          title: {
            type: 'string',
            description: 'Title',
            properties: { inner: { type: 'string', description: 'Inner' } },
          },
        }),
      ),
    ).toEqual(['title: properties on flat field string']);
  });

  it('names a malformed declaration nested one level down', () => {
    expect(
      shapeProblems(
        operationOver({
          items: {
            type: 'object[]',
            description: 'Items',
            properties: { nutrients: { type: 'object', description: 'Nutrients' } },
          },
        }),
      ),
    ).toEqual(['items.nutrients: object without properties']);
  });

  it('refuses a nested filter on a query op, before any tool schema exists', () => {
    const nestedFilterOperation: OpSpec = {
      kind: 'list',
      fields: mealFields,
      isDestructive: false,
    };

    expect(shapeProblems(nestedFilterOperation)).toContain('nutrients: object on a query op');
  });

  it('fails the derivation the MCP adapter calls, not a request assembly', () => {
    const malformedRegistry: ResourceRegistry = {
      name: 'saved-meals',
      basePath: '/api/saved-meals',
      ops: [{ kind: 'list', fields: mealFields, isDestructive: false }],
    };

    expect(() => deriveInputSchema(malformedRegistry, 'list')).toThrow(
      'malformed list declaration: nutrients: object on a query op',
    );
  });
});

/** A `create` op over an arbitrary table — the shape guard judges ops, not bare tables. */
function operationOver(fields: Record<string, FieldSpec>): OpSpec {
  return { kind: 'create', fields, isDestructive: true };
}

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
  it('accepts the kebab-case spelling of a camelCase field', () => {
    const call = parseCallCommand(
      ['notes', 'update', '--id', 'note-a', '--body', 'b', '--expected-version', '2'],
      notesService.registry,
    );

    expect(call.input['expectedVersion']).toBe(2);
  });

  it('turns a repeated numeric flag into a number array', () => {
    const call = parseCallCommand(
      ['notes', 'create', '--body', 'a', '--tagIds', '1', '--tagIds', '2'],
      tagRegistry,
    );

    expect(call.input['tagIds']).toEqual([1, 2]);
  });

  it('turns a single numeric flag occurrence into a one-element array', () => {
    const call = parseCallCommand(['notes', 'create', '--body', 'a', '--tagIds', '7'], tagRegistry);

    expect(call.input['tagIds']).toEqual([7]);
  });

  it('keeps repeated string flags a string array', () => {
    const call = parseCallCommand(
      ['sample', 'create', '--title', 'a', '--labels', 'x', '--labels', 'y'],
      sampleRegistry,
    );

    expect(call.input['labels']).toEqual(['x', 'y']);
  });

  it('converts a repeated non-numeric flag into a value the validator rejects', () => {
    const call = parseCallCommand(
      ['notes', 'create', '--body', 'a', '--tagIds', 'one'],
      tagRegistry,
    );
    const issues = validateInput(call.operation, call.input);

    expect(describeIssues('notes', 'create', issues)).toBe(
      'invalid input for notes.create: tagIds: expected number[]',
    );
  });

  it('parses a JSON object flag into the object value', () => {
    const call = parseCallCommand(
      ['saved-meals', 'create', '--name', 'a', '--nutrients', JSON.stringify(nutrientVector)],
      mealRegistry,
    );

    expect(call.input['nutrients']).toEqual(nutrientVector);
  });

  it('parses a JSON array flag into the array of objects', () => {
    const call = parseCallCommand(
      ['saved-meals', 'create', '--name', 'a', '--portions', '[{"label":"half","amount":2}]'],
      mealRegistry,
    );

    expect(call.input['portions']).toEqual([{ label: 'half', amount: 2 }]);
  });

  it('renders malformed JSON as the canonical validation message, not a SyntaxError', () => {
    const call = parseCallCommand(
      ['saved-meals', 'create', '--name', 'a', '--nutrients', 'not-json'],
      mealRegistry,
    );
    const issues = validateInput(call.operation, call.input);

    expect(describeIssues('saved-meals', 'create', issues)).toBe(
      'invalid input for saved-meals.create: nutrients: expected object',
    );
  });

  it('rejects a non-object JSON literal through the validator', () => {
    const call = parseCallCommand(
      ['saved-meals', 'create', '--name', 'a', '--nutrients', '5'],
      mealRegistry,
    );
    const issues = validateInput(call.operation, call.input);

    expect(describeIssues('saved-meals', 'create', issues)).toBe(
      'invalid input for saved-meals.create: nutrients: expected object',
    );
  });

  it('reaches the wire body unchanged from the CLI flag', () => {
    const parsed = parseCallCommand(
      ['saved-meals', 'create', '--name', 'a', '--nutrients', JSON.stringify(nutrientVector)],
      mealRegistry,
    );

    expect(wireFor(mealRegistry, 'create', parsed.input).body).toEqual({
      name: 'a',
      nutrients: nutrientVector,
    });
  });

  it('records the same request from the CLI and from an MCP object input', () => {
    const supplied = {
      name: 'a',
      nutrients: nutrientVector,
      portions: [{ label: 'half', amount: 2 }],
    };
    const call = parseCallCommand(
      [
        'saved-meals',
        'create',
        '--name',
        'a',
        '--nutrients',
        JSON.stringify(nutrientVector),
        '--portions',
        '[{"label":"half","amount":2}]',
      ],
      mealRegistry,
    );

    expect(wireFor(mealRegistry, 'create', call.input)).toEqual(
      wireFor(mealRegistry, 'create', supplied),
    );
  });
});

describe('the destructiveness flag', () => {
  // SPEC-ops-agent-contract §3.2, row by row over the closed kind set.
  const HINT_ROWS: Array<
    [OpSpec['kind'], { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }]
  > = [
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
    expect(listTools(notesRegistry).map((tool) => [tool.name, tool.title])).toEqual(
      NOTES_TOOL_ROWS,
    );
  });

  it('marks the read kinds read-only and non-destructive', () => {
    const tools = listTools(notesRegistry).filter((tool) => isReadTool(tool.name));

    expect(
      tools.map((tool) => [tool.annotations.readOnlyHint, tool.annotations.destructiveHint]),
    ).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it('marks every writing kind non-read-only and destructive', () => {
    const tools = listTools(notesRegistry).filter((tool) => !isReadTool(tool.name));

    expect(
      tools.map((tool) => [tool.annotations.readOnlyHint, tool.annotations.destructiveHint]),
    ).toEqual([
      [false, true],
      [false, true],
      [false, true],
      [false, true],
    ]);
  });

  it('closes the world for every notes tool', () => {
    expect(listTools(notesRegistry).every((tool) => tool.annotations.openWorldHint === false)).toBe(
      true,
    );
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
