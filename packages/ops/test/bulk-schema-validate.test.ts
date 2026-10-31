/**
 * Bulk schema and validation suite (SPEC-bulk-ops §2.3, §2.4, §2.5, §2.6): the
 * schema a caller reads and the refusals the validator raises are one contract.
 * The `items` property advertises the same cap the validator enforces, one item is
 * judged against the sibling op's own table at a dotted path, every refusal is a
 * call-level failure raised before item 0, and a bulk kind has no single wire
 * request to compile into. The suite runs twice — once with the default cap and
 * once under `LIFE_OPS_BULK_LIMIT=25`, which may move `maxItems` and nothing else —
 * so both comparisons are made against the resolved value, never a fixed 10.
 */
import { BULK_KINDS, resolveBulkLimit } from '../src/core/bulk';
import { deriveInputSchema } from '../src/core/schema';
import type { JsonSchema, JsonSchemaProperty } from '../src/core/schema';
import { findOp } from '../src/core/registry';
import { accepts } from './support/schema-accepts';
import { listTools } from '../src/mcp/tools';
import { BULK_WRAPPER_FIELD, describeIssues, validateInput } from '../src/core/validate';
import type { OpSpec, ResourceRegistry, WireRequest } from '../src/core/types';
import { wireFor } from '../src/core/wire';
import { sampleRegistry } from '../src/fixtures/sample';
import { service as notesService } from '../src/services/notes';
import { resources } from './support/bulk-service-module';

const journals = registryNamed('journals');
const entries = registryNamed('entries');
const notesRegistry = notesService.registry;

/** The cap this run resolves, so the suite holds under both runs of the file. */
const CAP = resolveBulkLimit(process.env);

/** The description the wrapper property carries; it names no number, the cap is `maxItems`. */
const ITEMS_DESCRIPTION = 'Items of the batch, submitted in order';

const BARE_ID_KINDS: OpSpec['kind'][] = ['getMany', 'deleteMany'];

/** Each object-item kind beside the single-row kind whose field table it copies. */
const OBJECT_ITEM_ROWS: Array<[OpSpec['kind'], OpSpec['kind']]> = [
  ['createMany', 'create'],
  ['updateMany', 'update'],
];

describe('the batch the schema advertises', () => {
  for (const kind of BULK_KINDS) {
    it(`requires one capped items array for ${kind}`, () => {
      const schema = deriveInputSchema(journals, kind);

      expect(schema.required).toEqual([BULK_WRAPPER_FIELD]);
      expect(Object.keys(schema.properties)).toEqual([BULK_WRAPPER_FIELD]);
      expect(schema.additionalProperties).toBe(false);
      expect(itemsPropertyOf(journals, kind)).toMatchObject({
        type: 'array',
        minItems: 1,
        maxItems: CAP,
      });
    });
  }

  it('moves only maxItems when the cap is raised', () => {
    const atDefault = deriveInputSchema(journals, 'getMany');
    const raised = deriveInputSchema(journals, 'getMany', 25);

    expect(itemsPropertyOf(journals, 'getMany', 25).maxItems).toBe(25);
    expect(raised).toEqual(withCap(atDefault, 25));
  });
});

describe('the item shape', () => {
  it('takes bare ids typed as the sibling id for getMany and deleteMany', () => {
    for (const kind of BARE_ID_KINDS) {
      expect(itemsPropertyOf(journals, kind)).toEqual({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: CAP,
        description: ITEMS_DESCRIPTION,
      });
    }
  });

  it('copies the sibling field table verbatim for createMany and updateMany', () => {
    for (const [kind, sibling] of OBJECT_ITEM_ROWS) {
      const siblingSchema = deriveInputSchema(journals, sibling);

      expect(itemsPropertyOf(journals, kind).items).toEqual({
        type: 'object',
        properties: siblingSchema.properties,
        required: siblingSchema.required,
        additionalProperties: false,
      });
    }
  });

  it('stays closed for a resource that never opted in', () => {
    expect(() => deriveInputSchema(entries, 'getMany')).toThrow('unknown operation: entries.getMany');
  });
});

describe('the schemas that already shipped', () => {
  it('keeps the notes read schema byte-identical', () => {
    expect(deriveInputSchema(notesRegistry, 'get')).toEqual({
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifier of the note to read' } },
      required: ['id'],
      additionalProperties: false,
    });
  });

  it('keeps the sample listing schema byte-identical', () => {
    expect(deriveInputSchema(sampleRegistry, 'list')).toEqual({
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Opaque page cursor from the previous listing' },
        limit: { type: 'number', description: 'Maximum samples to return in one page' },
        includeArchived: {
          type: 'boolean',
          description: 'Whether archived samples appear in the listing',
        },
      },
      required: [],
      additionalProperties: false,
    });
  });

  it('emits no array bounds on an existing kind', () => {
    expect(deriveInputSchema(notesRegistry, 'create').properties['tagIds']).toEqual({
      type: 'array',
      items: { type: 'number' },
      description: 'Tag ids to attach; omitting it leaves the note untagged',
    });
  });
});

/** Every bulk kind's title word, description tail, and hint row (§2.8, Task 5 AC 1 and 3). */
const BULK_TOOL_ROWS: Array<
  [OpSpec['kind'], string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }]
> = [
  ['getMany', 'Get many', { readOnlyHint: true, destructiveHint: false, idempotentHint: true }],
  ['createMany', 'Create many', { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
  ['updateMany', 'Update many', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ['deleteMany', 'Delete many', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
];

describe('the bulk tool a model reads', () => {
  for (const [kind, words, hints] of BULK_TOOL_ROWS) {
    it(`titles and describes ${kind} with its own words, and carries its hint row`, () => {
      const tool = toolOf(kind);

      expect(tool.title).toBe(`${words} journals`);
      expect(tool.description).toBe(
        `${words} journals through /api/journals, one result per item`,
      );
      expect(tool.annotations).toEqual({ ...hints, openWorldHint: false });
    });
  }
});

/** The one advertised tool for a fixture bulk kind, or a failure naming the kind that lost it. */
function toolOf(kind: OpSpec['kind']) {
  const name = `journals_${kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
  const tool = listTools(journals).find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`tools/list advertised no tool for ${kind}`);
  return tool;
}

describe('the batch envelope', () => {
  it('refuses a batch nobody sent', () => {
    expect(validateInput(findOp(journals, 'getMany'), {})).toEqual([
      { field: BULK_WRAPPER_FIELD, reason: 'required' },
    ]);
  });

  it('refuses an empty batch', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: [] })).toEqual([
      { field: BULK_WRAPPER_FIELD, reason: 'at least one item required' },
    ]);
  });

  // §2.3/§2.5: the derived schema declares `additionalProperties: false`, so the
  // validator refuses the same key rather than executing a batch around it.
  it('refuses a supplied top-level key the schema never advertises', () => {
    const supplied = { items: ['j1'], limit: 5 };

    expect(validateInput(findOp(journals, 'getMany'), supplied)).toEqual([
      { field: 'limit', reason: 'unknown field' },
    ]);
    expect(accepts(deriveInputSchema(journals, 'getMany'), supplied)).toBe(false);
  });

  it('refuses a batch that is not a list', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: 'j1' })).toEqual([
      { field: BULK_WRAPPER_FIELD, reason: 'expected array' },
    ]);
  });

  it('accepts a batch at exactly the resolved cap', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: ids(CAP) })).toEqual([]);
  });

  it('names the variable and the resolved value when the batch overflows', () => {
    const issues = validateInput(findOp(journals, 'getMany'), { items: ids(CAP + 1) });

    expect(describeIssues('journals', 'getMany', issues)).toBe(
      `invalid input for journals.getMany: items: exceeds LIFE_OPS_BULK_LIMIT (${CAP})`,
    );
  });

  it('names an explicitly passed cap rather than the environment', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: ids(26) }, 25)).toEqual([
      { field: BULK_WRAPPER_FIELD, reason: 'exceeds LIFE_OPS_BULK_LIMIT (25)' },
    ]);
  });
});

describe('the items of a batch', () => {
  it('accepts bare ids', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: ['j1', 'j2'] })).toEqual([]);
  });

  it('reports a malformed id at its dotted path', () => {
    expect(validateInput(findOp(journals, 'getMany'), { items: ['j1', 2] })).toEqual([
      { field: 'items.1.id', reason: 'expected string' },
    ]);
  });

  it('reports a non-object item at its index', () => {
    expect(validateInput(findOp(journals, 'createMany'), { items: ['j1'] })).toEqual([
      { field: 'items.0', reason: 'expected object' },
    ]);
  });

  // §2.5/§7: an item is judged against the sibling's own table, so a key that table
  // never declares is refused at its dotted path — and the advertised item schema is
  // closed for the same key, so the two never disagree.
  it('reports an unknown key inside an item at its dotted path', () => {
    const supplied = { items: [{ title: 'a' }, { title: 'b', colour: 'red' }] };
    const itemSchema = itemsPropertyOf(journals, 'createMany').items;

    expect(validateInput(findOp(journals, 'createMany'), supplied)).toEqual([
      { field: 'items.1.colour', reason: 'unknown field' },
    ]);
    expect(itemSchema).toMatchObject({ additionalProperties: false });
    expect(accepts(deriveInputSchema(journals, 'createMany'), supplied)).toBe(false);
  });

  it('reports a missing required field of one item', () => {
    expect(
      validateInput(findOp(journals, 'createMany'), { items: [{ title: 'a' }, { body: 'b' }] }),
    ).toEqual([{ field: 'items.1.title', reason: 'required' }]);
  });

  it('rejects an update item that names no row', () => {
    expect(
      validateInput(findOp(journals, 'updateMany'), {
        items: [{ id: 'j1', title: 'a' }, { title: 'b' }],
      }),
    ).toEqual([{ field: 'items.1.id', reason: 'required' }]);
  });

  it('accepts an update item carrying only its id and one changed field', () => {
    expect(
      validateInput(findOp(journals, 'updateMany'), { items: [{ id: 'j1', title: 'a' }] }),
    ).toEqual([]);
  });
});

/** The six single-row requests, exactly as they compiled before the bulk kinds arrived. */
const SINGLE_WIRE_CASES: Array<{
  kind: OpSpec['kind'];
  supplied: Record<string, unknown>;
  wire: WireRequest;
}> = [
  {
    kind: 'create',
    supplied: { body: 'one' },
    wire: { method: 'POST', path: '/api/notes', query: {}, body: { body: 'one' } },
  },
  {
    kind: 'get',
    supplied: { id: 'n1' },
    wire: { method: 'GET', path: '/api/notes/n1', query: {}, body: undefined },
  },
  {
    kind: 'list',
    supplied: { limit: 5 },
    wire: { method: 'GET', path: '/api/notes', query: { limit: '5' }, body: {} },
  },
  {
    kind: 'update',
    supplied: { id: 'n1', body: 'two' },
    wire: { method: 'PATCH', path: '/api/notes/n1', query: {}, body: { body: 'two' } },
  },
  {
    kind: 'delete',
    supplied: { id: 'n1' },
    wire: { method: 'DELETE', path: '/api/notes/n1', query: {}, body: undefined },
  },
  {
    kind: 'restore',
    supplied: { id: 'n1' },
    wire: { method: 'POST', path: '/api/notes/n1/restore', query: {}, body: undefined },
  },
];

describe('the wire mapping', () => {
  for (const kind of BULK_KINDS) {
    it(`refuses to compile ${kind} into one request`, () => {
      expect(() => wireFor(journals, kind, { items: ['j1'] })).toThrow(
        `bulk kind ${kind} has no single wire request; fan out instead`,
      );
    });
  }

  for (const singleRowCase of SINGLE_WIRE_CASES) {
    it(`still maps ${singleRowCase.kind} unchanged`, () => {
      expect(wireFor(notesRegistry, singleRowCase.kind, singleRowCase.supplied)).toEqual(
        singleRowCase.wire,
      );
    });
  }
});

/** The `items` property of one bulk op's schema, at the environment's cap unless one is passed. */
function itemsPropertyOf(
  registry: ResourceRegistry,
  kind: OpSpec['kind'],
  bulkLimit?: number,
): JsonSchemaProperty {
  return deriveInputSchema(registry, kind, bulkLimit).properties[BULK_WRAPPER_FIELD];
}

/** The same schema with its advertised cap replaced, so the rest can be compared byte for byte. */
function withCap(schema: JsonSchema, bulkLimit: number): JsonSchema {
  const items = schema.properties[BULK_WRAPPER_FIELD];
  return {
    ...schema,
    properties: { ...schema.properties, [BULK_WRAPPER_FIELD]: { ...items, maxItems: bulkLimit } },
  };
}

function registryNamed(name: string): ResourceRegistry {
  const registry = resources.find((candidate) => candidate.name === name);
  if (registry === undefined) throw new Error(`no fixture registry named ${name}`);
  return registry;
}

/** `count` ids, for the batches that sit exactly at or just over the cap. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `j${index}`);
}
