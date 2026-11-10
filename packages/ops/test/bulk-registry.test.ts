/**
 * Registry opt-in suite (SPEC-bulk-ops §2.1, §2.2): `bulk: true` is the whole
 * per-resource declaration, and the four bulk ops are derived from the ops the
 * resource already wrote rather than spelled out again. Each derived op copies
 * its sibling's field table, so a field change reaches bulk behaviour without a
 * second edit. A source gap derives nothing, the wrapper field name is reserved,
 * and a resource that never opts in holds zero bulk ops — bulk stays dormant
 * until a resource asks for it, which no shipped module does.
 */
import { BULK_KINDS, bulkSourceKind } from '../src/core/bulk.js';
import { defineResource, findOp, kindIsDestructive } from '../src/core/registry.js';
import type { OpSpec, ResourceRegistry } from '../src/core/types.js';
import { loadService } from '../src/cli/run.js';
import { sampleRegistry } from '../src/fixtures/sample.js';

/** The four source ops every opt-in case fans out over, in the shipped declaration order. */
const sourceOps: OpSpec[] = [
  {
    kind: 'create',
    fields: { title: { type: 'string', required: true, description: 'Title of the entry' } },
  },
  {
    kind: 'get',
    fields: { id: { type: 'string', required: true, description: 'Identifier of the entry' } },
  },
  {
    kind: 'update',
    fields: {
      id: { type: 'string', required: true, description: 'Identifier of the entry' },
      title: { type: 'string', description: 'Replacement title' },
    },
  },
  {
    kind: 'delete',
    fields: { id: { type: 'string', required: true, description: 'Identifier of the entry' } },
  },
];

const opsWithoutDelete = sourceOps.filter((operation) => operation.kind !== 'delete');

/** Each bulk kind beside the single-row kind it fans out over. */
const bulkPairs: [OpSpec['kind'], OpSpec['kind']][] = [
  ['getMany', 'get'],
  ['createMany', 'create'],
  ['updateMany', 'update'],
  ['deleteMany', 'delete'],
];

describe('a resource that opts in over every source kind', () => {
  const journals = defineResource({
    name: 'journals',
    basePath: '/api/journals',
    ops: sourceOps,
    bulk: true,
  });

  it('appends exactly the four bulk kinds after its declared ops', () => {
    expect(journals.ops.map((operation) => operation.kind)).toEqual([
      'create',
      'get',
      'update',
      'delete',
      'getMany',
      'createMany',
      'updateMany',
      'deleteMany',
    ]);
  });

  it.each(bulkPairs)('gives %s its sibling %s field table verbatim', (bulkKind, sourceKind) => {
    expect(findOp(journals, bulkKind).fields).toEqual(findOp(journals, sourceKind).fields);
  });

  it('applies each derived kind its destructive default', () => {
    expect(BULK_KINDS.map((bulkKind) => findOp(journals, bulkKind).isDestructive)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('a resource whose only source gap is delete', () => {
  const drafts = defineResource({
    name: 'drafts',
    basePath: '/api/drafts',
    ops: opsWithoutDelete,
    bulk: true,
  });

  it('derives the three kinds it can fan out over', () => {
    expect(drafts.ops.map((operation) => operation.kind)).toEqual([
      'create',
      'get',
      'update',
      'getMany',
      'createMany',
      'updateMany',
    ]);
  });

  it('derives no deleteMany', () => {
    expect(() => findOp(drafts, 'deleteMany')).toThrow('unknown operation: drafts.deleteMany');
  });
});

describe('a resource without the opt-in', () => {
  it('keeps the ops it declared when bulk is absent', () => {
    const entries = defineResource({ name: 'entries', basePath: '/api/entries', ops: sourceOps });

    expect(entries.ops.map((operation) => operation.kind)).toEqual(sourceOps.map((op) => op.kind));
    expect(entries.bulk).toBe(false);
  });

  it('keeps the ops it declared when bulk is false', () => {
    const entries = defineResource({
      name: 'entries',
      basePath: '/api/entries',
      ops: sourceOps,
      bulk: false,
    });

    expect(entries.ops.filter((operation) => bulkSourceKind(operation.kind) !== undefined)).toEqual(
      [],
    );
  });

  it('still throws when asked for a bulk kind', () => {
    const entries = defineResource({ name: 'entries', basePath: '/api/entries', ops: sourceOps });

    expect(() => findOp(entries, 'getMany')).toThrow('unknown operation: entries.getMany');
  });
});

describe('a source op that declares the wrapper field', () => {
  const collidingOps: OpSpec[] = [
    {
      kind: 'get',
      fields: {
        id: { type: 'string', required: true, description: 'Identifier of the entry' },
        items: { type: 'number[]', description: 'Ids of the parts of this entry' },
      },
    },
  ];

  it('refuses the opt-in, naming the resource and the field', () => {
    const refuse = () =>
      defineResource({ name: 'notes', basePath: '/api/notes', ops: collidingOps, bulk: true });

    expect(refuse).toThrow(/resource notes .*field items/);
  });
});

describe('the destructive table', () => {
  it('calls only the three write bulk kinds destructive', () => {
    expect(kindIsDestructive('getMany')).toBe(false);
    expect(kindIsDestructive('createMany')).toBe(true);
    expect(kindIsDestructive('updateMany')).toBe(true);
    expect(kindIsDestructive('deleteMany')).toBe(true);
  });
});

describe('the shipped registries', () => {
  const shippedServices = ['notes', 'todo', 'meal', 'tags', 'focus', 'feedback'];

  it.each(shippedServices)('leaves service %s holding no bulk op', async (serviceName) => {
    const service = await loadService({ LIFE_OPS_SERVICE: serviceName });
    const resources = service.resources ?? [service.registry];

    resources.forEach((resource) => expectBulkFree(resource));
  });

  it('leaves the sample fixture holding no bulk op', () => {
    expectBulkFree(sampleRegistry);
  });
});

function expectBulkFree(resource: ResourceRegistry): void {
  expect(resource.ops.filter((operation) => bulkSourceKind(operation.kind) !== undefined)).toEqual(
    [],
  );
}
