/**
 * Wire suite (SPEC.md §3, §7): one registry op compiles to exactly one HTTP
 * request, and `restore` — the sixth and newest kind — compiles without giving
 * the registry a per-operation route override. The regression table pins the
 * five kinds that existed before it byte for byte, so the kind's arrival is
 * provably additive.
 */
import { defineResource, findOp, kindIsDestructive } from '../src/core/registry';
import { wireFor } from '../src/core/wire';
import { listTools } from '../src/mcp/tools';
import { sampleRegistry } from '../src/fixtures/sample';
import { service } from '../src/services/notes';
import type { OpSpec, ResourceRegistry, WireRequest } from '../src/core/types';

/** One kind's compiled request: the input an adapter hands to `wireFor`, then what it must produce. */
interface WireCase {
  kind: OpSpec['kind'];
  supplied: Record<string, unknown>;
  expected: WireRequest;
}

const restoreRegistry: ResourceRegistry = defineResource({
  name: 'sample',
  basePath: '/samples',
  ops: [
    {
      kind: 'restore',
      fields: {
        id: { type: 'string', required: true, description: 'Identifier of the sample to bring back' },
      },
    },
  ],
});

describe('the requests the five original kinds compile to', () => {
  const cases: WireCase[] = [
    {
      kind: 'create',
      supplied: { title: 'a', priority: 2, labels: ['x'] },
      expected: {
        method: 'POST',
        path: '/samples',
        query: {},
        body: { title: 'a', priority: 2, labels: ['x'] },
      },
    },
    {
      kind: 'get',
      supplied: { id: 'r1' },
      expected: { method: 'GET', path: '/samples/r1', query: {}, body: undefined },
    },
    {
      kind: 'list',
      supplied: { limit: 2, cursor: 'c1' },
      expected: { method: 'GET', path: '/samples', query: { limit: '2', cursor: 'c1' }, body: {} },
    },
    {
      kind: 'update',
      supplied: { id: 'r1', title: 'b', expectedVersion: 3 },
      expected: {
        method: 'PATCH',
        path: '/samples/r1',
        query: {},
        body: { title: 'b', expectedVersion: 3 },
      },
    },
    {
      kind: 'delete',
      supplied: { id: 'r1' },
      expected: { method: 'DELETE', path: '/samples/r1', query: {}, body: undefined },
    },
  ];

  it.each(cases)('compiles $kind unchanged', ({ kind, supplied, expected }) => {
    expect(wireFor(sampleRegistry, kind, supplied)).toEqual(expected);
  });
});

describe('the restore kind', () => {
  it('posts to the addressed row’s restore sub-path with no query and no body', () => {
    expect(wireFor(restoreRegistry, 'restore', { id: 'r1' })).toEqual({
      method: 'POST',
      path: '/samples/r1/restore',
      query: {},
      body: undefined,
    });
  });

  it('percent-encodes the id it addresses', () => {
    expect(wireFor(restoreRegistry, 'restore', { id: 'a/b' }).path).toBe('/samples/a%2Fb/restore');
  });

  it('is destructive until its author says otherwise', () => {
    expect(kindIsDestructive('restore')).toBe(true);
    expect(findOp(restoreRegistry, 'restore').isDestructive).toBe(true);
  });

  it('keeps the registry free of a per-operation route override', () => {
    expect(Object.keys(findOp(restoreRegistry, 'restore')).sort()).toEqual([
      'fields',
      'isDestructive',
      'kind',
    ]);
  });
});

describe('the tool a restore op advertises', () => {
  it('names and titles itself the way every other kind does', () => {
    const tool = listTools(restoreRegistry).find((candidate) => candidate.name === 'sample_restore');
    expect(tool?.title).toBe('Restore sample');
  });

  it('states non-read-only, destructive, idempotent, closed-world hints', () => {
    const tool = listTools(restoreRegistry).find((candidate) => candidate.name === 'sample_restore');
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

/**
 * The notes module (SPEC-ops-notes-service §1.1): the six ops a real service
 * module declares compile to the six requests `note-service` serves. The table
 * is read per op, so a field that drifts from the DTOs fails one named case
 * rather than a whole-registry comparison.
 */
describe('the requests the notes module compiles to', () => {
  const cases: WireCase[] = [
    {
      kind: 'create',
      supplied: { body: 'hello' },
      expected: { method: 'POST', path: '/api/notes', query: {}, body: { body: 'hello' } },
    },
    {
      kind: 'get',
      supplied: { id: 'n1' },
      expected: { method: 'GET', path: '/api/notes/n1', query: {}, body: undefined },
    },
    {
      kind: 'list',
      supplied: { tagId: 2, q: 'milk', limit: 20, cursor: 'c1' },
      expected: {
        method: 'GET',
        path: '/api/notes',
        query: { tagId: '2', q: 'milk', limit: '20', cursor: 'c1' },
        body: {},
      },
    },
    {
      kind: 'update',
      supplied: { id: 'n1', body: 'edited', tagIds: [2], expectedVersion: 3 },
      expected: {
        method: 'PATCH',
        path: '/api/notes/n1',
        query: {},
        body: { body: 'edited', tagIds: [2], expectedVersion: 3 },
      },
    },
    {
      kind: 'delete',
      supplied: { id: 'n1' },
      expected: { method: 'DELETE', path: '/api/notes/n1', query: {}, body: undefined },
    },
    {
      kind: 'restore',
      supplied: { id: 'n1' },
      expected: { method: 'POST', path: '/api/notes/n1/restore', query: {}, body: undefined },
    },
  ];

  it.each(cases)('compiles $kind against the notes route', ({ kind, supplied, expected }) => {
    expect(wireFor(service.registry, kind, supplied)).toEqual(expected);
  });

  it('tags a create only when the caller supplies tag ids', () => {
    expect(wireFor(service.registry, 'create', { body: 'hello', tagIds: [1, 2] }).body).toEqual({
      body: 'hello',
      tagIds: [1, 2],
    });
  });

  it('patches with an empty body when the caller supplies only the id', () => {
    expect(wireFor(service.registry, 'update', { id: 'n1' }).body).toEqual({});
  });
});

describe('the notes module declaration', () => {
  it('names its resource and base path after the service route', () => {
    expect(service.registry.name).toBe('notes');
    expect(service.registry.basePath).toBe('/api/notes');
  });

  it('declares the six ops in the spec’s order', () => {
    expect(service.registry.ops.map((operation) => operation.kind)).toEqual([
      'create',
      'get',
      'list',
      'update',
      'delete',
      'restore',
    ]);
  });

  it('takes its base from the environment rather than hardcoding one', () => {
    expect(service.apiBase).toBeUndefined();
  });

  it('leaves every op to the kind default for destructiveness', () => {
    expect(
      Object.fromEntries(
        service.registry.ops.map((operation) => [operation.kind, operation.isDestructive]),
      ),
    ).toEqual({
      create: true,
      get: false,
      list: false,
      update: true,
      delete: true,
      restore: true,
    });
  });

  it('offers no route that destroys rows in bulk', () => {
    for (const operation of service.registry.ops) {
      const request = wireFor(service.registry, operation.kind, { id: 'n1' });
      expect(request.path).not.toContain('permanent');
      expect(request.path).not.toBe('/api/notes/trash');
    }
  });
});
