/**
 * Wire suite (SPEC.md §3, §7): one registry op compiles to exactly one HTTP
 * request, and `restore` — the sixth and newest kind — compiles without giving
 * the registry a per-operation route override. The regression table pins the
 * five kinds that existed before it byte for byte, so the kind's arrival is
 * provably additive. The table after the notes module pins the whole 36-route
 * surface the five new service modules add (SPEC-ops-all-services §8.3), and the
 * eleven routes the intent cuts beside it as unreachable (§1.7). The nested suites
 * at the end prove a body carries a nested value untouched, while a nested filter
 * is refused at the schema derivation every adapter calls — before any request
 * exists to assemble.
 */
import { defineResource, fieldNames, findOp, kindIsDestructive } from '../src/core/registry';
import { wireFor } from '../src/core/wire';
import { deriveInputSchema, toolName } from '../src/core/schema';
import { validateInput } from '../src/core/validate';
import { listTools } from '../src/mcp/tools';
import { parseCallCommand } from '../src/cli/parse';
import { sampleRegistry } from '../src/fixtures/sample';
import { service } from '../src/services/notes';
import { resources as focusResources } from '../src/services/focus';
import { resources as mealResources } from '../src/services/meal';
import { resources as tagResources } from '../src/services/tags';
import { resources as todoResources } from '../src/services/todo';
import { service as feedbackService } from '../src/services/feedback';
import type { OpSpec, ResourceRegistry, WireRequest } from '../src/core/types';
import { accepts } from './support/schema-accepts';

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
/**
 * The route surface the five new modules add (SPEC-ops-all-services §1.2–§1.6):
 * one row per route, 36 in all, each compiled from a fully supplied input, so the
 * method, path, query, and body of that route are pinned together. Every row names
 * its resource, which the suites below also read as a CLI command and a tool prefix.
 */
const everyServiceResource: ResourceRegistry[] = [
  ...todoResources,
  ...mealResources,
  ...tagResources,
  ...focusResources,
  feedbackService.registry,
];

/** The resource the five modules register under `name`; a mistyped row fails here. */
function resourceNamed(name: string): ResourceRegistry {
  const resource = everyServiceResource.find((candidate) => candidate.name === name);
  if (resource === undefined) throw new Error(`unknown resource: ${name}`);
  return resource;
}

const suppliedTodoCreate = {
  title: 'buy milk',
  note: 'two cartons',
  dueDate: '2026-03-01T09:30',
  repeat: 'weekly',
  repeatDays: [1, 3],
  listId: 'list-a',
  important: true,
  tagIds: [1, 2],
};

const suppliedTodoFilters = {
  q: 'milk',
  listId: 'list-a',
  tagId: 2,
  done: true,
  important: true,
  dueBefore: '2026-03-01',
  dueAfter: '2026-02-01',
  limit: 20,
  cursor: 'c1',
};

/** The same listing as it travels: a `list` query carries every value as text. */
const queriedTodoFilters = {
  q: 'milk',
  listId: 'list-a',
  tagId: '2',
  done: 'true',
  important: 'true',
  dueBefore: '2026-03-01',
  dueAfter: '2026-02-01',
  limit: '20',
  cursor: 'c1',
};

const suppliedTodoPatch = {
  title: 'buy oat milk',
  note: 'two cartons',
  done: true,
  dueDate: '2026-03-02T09:30',
  repeat: 'daily',
  repeatDays: [2],
  listId: 'list-b',
  important: false,
  tagIds: [3],
  expectedVersion: 3,
};

const suppliedListCreate = { name: 'Home', importantDefault: true };
const suppliedListPatch = { name: 'Household', importantDefault: false, expectedVersion: 3 };

const suppliedPage = { limit: 20, cursor: 'c1' };
const queriedPage = { limit: '20', cursor: 'c1' };

/** The nutrient amounts a caller confirms when it logs a food or an entry. */
const suppliedNutrients = { calories: 400, protein: 20, sodium: 300 };

/** One pickable measure of a food, and one frozen item of a saved meal. */
const suppliedPortion = { label: '1 carton', amount: 250 };
const suppliedSavedMealItem = { foodId: 'f1', quantity: 2, nutrients: suppliedNutrients };

const suppliedEntryCreate = {
  date: '2026-03-01',
  mealGroup: 'lunch',
  foodId: 'f1',
  quantity: 2,
  nutrients: suppliedNutrients,
};

const entryFilters = { date: '2026-03-01', meal: 'lunch' };

const suppliedEntryPatch = {
  date: '2026-03-02',
  mealGroup: 'dinner',
  quantity: 1,
  nutrients: suppliedNutrients,
  expectedVersion: 3,
};

const suppliedFoodCreate = {
  name: 'Oats',
  unit: 'g',
  servingGrams: 40,
  portions: [suppliedPortion],
  nutrients: suppliedNutrients,
};

const suppliedFoodFilters = { q: 'oat', includeDeleted: true };
const queriedFoodFilters = { q: 'oat', includeDeleted: 'true' };

const suppliedFoodPatch = {
  name: 'Rolled oats',
  servingGrams: 45,
  portions: [suppliedPortion],
  nutrients: suppliedNutrients,
  expectedVersion: 3,
};

const suppliedSavedMealCreate = {
  name: 'Breakfast bowl',
  mealGroup: 'breakfast',
  items: [suppliedSavedMealItem],
};

const targetDay = { date: '2026-03-01' };

const suppliedTagCreate = { name: 'errand' };
const suppliedTagPatch = { name: 'errands', expectedVersion: 3 };
const suppliedTagIds = { ids: [1, 2] };

const suppliedSessionCreate = { date: '2026-03-01', minutes: 25 };
const sessionRange = { from: '2026-03-01', to: '2026-03-07' };

const suppliedFeedbackId = '9d1c2f44-0a3c-4b9e-9f21-6a5c8d7e0b13';
const suppliedFeedbackPatch = { status: 'in_progress' };

/** One route: the module it belongs to, the input it takes, the request it must compile to. */
interface RouteCase {
  resource: string;
  kind: OpSpec['kind'];
  supplied: Record<string, unknown>;
  expected: WireRequest;
}

const routeTable: RouteCase[] = [
  {
    resource: 'todos',
    kind: 'create',
    supplied: suppliedTodoCreate,
    expected: { method: 'POST', path: '/api/todos', query: {}, body: suppliedTodoCreate },
  },
  {
    resource: 'todos',
    kind: 'list',
    supplied: suppliedTodoFilters,
    expected: { method: 'GET', path: '/api/todos', query: queriedTodoFilters, body: {} },
  },
  {
    resource: 'todos',
    kind: 'get',
    supplied: { id: 't1' },
    expected: { method: 'GET', path: '/api/todos/t1', query: {}, body: undefined },
  },
  {
    resource: 'todos',
    kind: 'update',
    supplied: { id: 't1', ...suppliedTodoPatch },
    expected: { method: 'PATCH', path: '/api/todos/t1', query: {}, body: suppliedTodoPatch },
  },
  {
    resource: 'todos',
    kind: 'delete',
    supplied: { id: 't1' },
    expected: { method: 'DELETE', path: '/api/todos/t1', query: {}, body: undefined },
  },
  {
    resource: 'todos',
    kind: 'restore',
    supplied: { id: 't1' },
    expected: { method: 'POST', path: '/api/todos/t1/restore', query: {}, body: undefined },
  },
  {
    resource: 'todos-tags',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/todos/tags', query: {}, body: {} },
  },
  {
    resource: 'todos-trash',
    kind: 'list',
    supplied: suppliedPage,
    expected: { method: 'GET', path: '/api/todos/trash', query: queriedPage, body: {} },
  },
  {
    resource: 'todos-completions',
    kind: 'list',
    supplied: suppliedPage,
    expected: { method: 'GET', path: '/api/todos/completions', query: queriedPage, body: {} },
  },
  {
    resource: 'lists',
    kind: 'create',
    supplied: suppliedListCreate,
    expected: { method: 'POST', path: '/api/lists', query: {}, body: suppliedListCreate },
  },
  {
    resource: 'lists',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/lists', query: {}, body: {} },
  },
  {
    resource: 'lists',
    kind: 'update',
    supplied: { id: 'list-a', ...suppliedListPatch },
    expected: { method: 'PATCH', path: '/api/lists/list-a', query: {}, body: suppliedListPatch },
  },
  {
    resource: 'entries',
    kind: 'create',
    supplied: suppliedEntryCreate,
    expected: { method: 'POST', path: '/api/entries', query: {}, body: suppliedEntryCreate },
  },
  {
    resource: 'entries',
    kind: 'list',
    supplied: entryFilters,
    expected: { method: 'GET', path: '/api/entries', query: entryFilters, body: {} },
  },
  {
    resource: 'entries',
    kind: 'get',
    supplied: { id: 'e1' },
    expected: { method: 'GET', path: '/api/entries/e1', query: {}, body: undefined },
  },
  {
    resource: 'entries',
    kind: 'update',
    supplied: { id: 'e1', ...suppliedEntryPatch },
    expected: { method: 'PATCH', path: '/api/entries/e1', query: {}, body: suppliedEntryPatch },
  },
  {
    resource: 'entries',
    kind: 'delete',
    supplied: { id: 'e1' },
    expected: { method: 'DELETE', path: '/api/entries/e1', query: {}, body: undefined },
  },
  {
    resource: 'foods',
    kind: 'create',
    supplied: suppliedFoodCreate,
    expected: { method: 'POST', path: '/api/foods', query: {}, body: suppliedFoodCreate },
  },
  {
    resource: 'foods',
    kind: 'list',
    supplied: suppliedFoodFilters,
    expected: { method: 'GET', path: '/api/foods', query: queriedFoodFilters, body: {} },
  },
  {
    resource: 'foods',
    kind: 'get',
    supplied: { id: 'f1' },
    expected: { method: 'GET', path: '/api/foods/f1', query: {}, body: undefined },
  },
  {
    resource: 'foods',
    kind: 'update',
    supplied: { id: 'f1', ...suppliedFoodPatch },
    expected: { method: 'PATCH', path: '/api/foods/f1', query: {}, body: suppliedFoodPatch },
  },
  {
    resource: 'foods',
    kind: 'delete',
    supplied: { id: 'f1' },
    expected: { method: 'DELETE', path: '/api/foods/f1', query: {}, body: undefined },
  },
  {
    resource: 'saved-meals',
    kind: 'create',
    supplied: suppliedSavedMealCreate,
    expected: { method: 'POST', path: '/api/saved-meals', query: {}, body: suppliedSavedMealCreate },
  },
  {
    resource: 'saved-meals',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/saved-meals', query: {}, body: {} },
  },
  {
    resource: 'saved-meals',
    kind: 'get',
    supplied: { id: 'm1' },
    expected: { method: 'GET', path: '/api/saved-meals/m1', query: {}, body: undefined },
  },
  {
    resource: 'saved-meals',
    kind: 'delete',
    supplied: { id: 'm1' },
    expected: { method: 'DELETE', path: '/api/saved-meals/m1', query: {}, body: undefined },
  },
  {
    resource: 'target',
    kind: 'list',
    supplied: targetDay,
    expected: { method: 'GET', path: '/api/target', query: targetDay, body: {} },
  },
  {
    resource: 'tags',
    kind: 'create',
    supplied: suppliedTagCreate,
    expected: { method: 'POST', path: '/api/tags', query: {}, body: suppliedTagCreate },
  },
  {
    resource: 'tags',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/tags', query: {}, body: {} },
  },
  {
    resource: 'tags',
    kind: 'update',
    supplied: { id: 7, ...suppliedTagPatch },
    expected: { method: 'PATCH', path: '/api/tags/7', query: {}, body: suppliedTagPatch },
  },
  {
    resource: 'tags-resolve',
    kind: 'create',
    supplied: suppliedTagIds,
    expected: { method: 'POST', path: '/api/tags/resolve', query: {}, body: suppliedTagIds },
  },
  {
    resource: 'goal',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/goal', query: {}, body: {} },
  },
  {
    resource: 'sessions',
    kind: 'create',
    supplied: suppliedSessionCreate,
    expected: { method: 'POST', path: '/api/sessions', query: {}, body: suppliedSessionCreate },
  },
  {
    resource: 'sessions',
    kind: 'list',
    supplied: sessionRange,
    expected: { method: 'GET', path: '/api/sessions', query: sessionRange, body: {} },
  },
  {
    resource: 'feedback',
    kind: 'list',
    supplied: {},
    expected: { method: 'GET', path: '/api/feedback', query: {}, body: {} },
  },
  {
    resource: 'feedback',
    kind: 'update',
    supplied: { id: suppliedFeedbackId, ...suppliedFeedbackPatch },
    expected: {
      method: 'PATCH',
      path: `/api/feedback/${suppliedFeedbackId}`,
      query: {},
      body: suppliedFeedbackPatch,
    },
  },
];

/** The routes `rowsFor` counts, so a row deleted from the table fails one named resource. */
function rowsFor(resourceName: string): RouteCase[] {
  return routeTable.filter((row) => row.resource === resourceName);
}

describe('the routes the five new modules compile to', () => {
  it.each(routeTable)(
    'compiles $resource $kind to its own route',
    ({ resource, kind, supplied, expected }) => {
      expect(wireFor(resourceNamed(resource), kind, supplied)).toEqual(expected);
    },
  );

  it('pins 36 routes, counted per resource', () => {
    expect(routeTable).toHaveLength(36);
    expect(
      Object.fromEntries(
        everyServiceResource.map((resource) => [resource.name, rowsFor(resource.name).length]),
      ),
    ).toEqual({
      todos: 6,
      'todos-tags': 1,
      'todos-trash': 1,
      'todos-completions': 1,
      lists: 3,
      entries: 5,
      foods: 5,
      'saved-meals': 4,
      target: 1,
      tags: 3,
      'tags-resolve': 1,
      goal: 1,
      sessions: 2,
      feedback: 2,
    });
  });

  it('leaves no declared op unasserted', () => {
    const declaredRoutes = everyServiceResource.flatMap((resource) =>
      resource.ops.map((operation) => `${resource.name}.${operation.kind}`),
    );
    const assertedRoutes = routeTable.map((row) => `${row.resource}.${row.kind}`);

    expect(assertedRoutes.sort()).toEqual(declaredRoutes.sort());
  });
});

describe('the resource names the five new modules register', () => {
  it('serves each name as the CLI command that addresses its ops', () => {
    for (const resource of everyServiceResource) {
      for (const operation of resource.ops) {
        const call = parseCallCommand([resource.name, operation.kind], resource);
        expect(call.operation).toBe(operation);
      }
    }
  });

  it('prefixes every MCP tool with its resource name', () => {
    for (const resource of everyServiceResource) {
      expect(listTools(resource).map((tool) => tool.name)).toEqual(
        resource.ops.map((operation) => toolName(resource, operation)),
      );
    }
  });
});

/**
 * One route the intent cuts (SPEC-ops-all-services §1.7), named the way a caller
 * would attempt it: the resource it would address, the op kind that would compile
 * it, and the method and path that would then reach the service. Paths spell the
 * probe address (`x`) wherever the cut route carries an id.
 */
interface CutRoute {
  resource: string;
  kind: OpSpec['kind'];
  /** Spelled wider than `HttpMethod`: `PUT` is itself one of the cuts (§1.7). */
  method: string;
  path: string;
}

const PROBE_ADDRESS = { id: 'x' };

const absentRoutes: CutRoute[] = [
  { resource: 'goal', kind: 'update', method: 'PUT', path: '/api/goal' },
  { resource: 'target', kind: 'update', method: 'PUT', path: '/api/target/profile' },
  { resource: 'push', kind: 'delete', method: 'DELETE', path: '/api/push/subscribe' },
  { resource: 'push', kind: 'list', method: 'GET', path: '/api/push/key' },
  { resource: 'push', kind: 'create', method: 'POST', path: '/api/push/subscribe' },
  { resource: 'todos-trash', kind: 'delete', method: 'DELETE', path: '/api/todos/trash' },
  { resource: 'todos', kind: 'delete', method: 'DELETE', path: '/api/todos/x/permanent' },
  { resource: 'estimates', kind: 'create', method: 'POST', path: '/api/estimates/photo' },
  { resource: 'tags', kind: 'delete', method: 'DELETE', path: '/api/tags/x' },
  { resource: 'lists', kind: 'delete', method: 'DELETE', path: '/api/lists/x' },
  { resource: 'feedback', kind: 'create', method: 'POST', path: '/api/feedback' },
];

/** The request the five modules compile for one resource's op, or `undefined` when neither exists. */
function compiledRoute({ resource, kind }: CutRoute): WireRequest | undefined {
  const registry = everyServiceResource.find((candidate) => candidate.name === resource);
  if (registry === undefined) return undefined;
  const operation = registry.ops.find((candidate) => candidate.kind === kind);
  return operation === undefined ? undefined : wireFor(registry, kind, PROBE_ADDRESS);
}

describe('the routes the intent cuts', () => {
  it('counts the eleven routes §1.7 cuts', () => {
    expect(absentRoutes).toHaveLength(11);
  });

  it.each(absentRoutes)('reaches no $method $path', ({ resource, kind, method, path }) => {
    expect(compiledRoute({ resource, kind, method, path })).not.toEqual(
      expect.objectContaining({ method, path }),
    );
  });

  it('refuses null on every field of every route', () => {
    for (const resource of everyServiceResource) {
      for (const operation of resource.ops) {
        for (const fieldName of fieldNames(operation)) {
          expect(validateInput(operation, { [fieldName]: null })).toContainEqual({
            field: fieldName,
            reason: `expected ${operation.fields[fieldName].type}`,
          });
        }
      }
    }
  });
});

/**
 * The saved-meals `create` op shape (SPEC-ops-all-services §1.3): two nested
 * fields, and a nested `nutrients` two levels down inside `items`. Declared as a
 * plain table, without a `defineResource` round trip, so this suite reads the body
 * mapping alone; `normalizeField` keeps nested `properties` (spec §4 as amended,
 * Open Question 6.4), so the registry carries them intact and `meal-parity.test.ts` proves it.
 */
const mealRegistry: ResourceRegistry = {
  name: 'saved-meals',
  basePath: '/api/saved-meals',
  ops: [
    {
      kind: 'create',
      fields: {
        name: { type: 'string', required: true, description: 'Saved meal name' },
        nutrients: {
          type: 'object',
          required: true,
          properties: {
            calories: { type: 'number', required: true, description: 'Energy in kcal' },
          },
          description: 'Nutrient vector',
        },
        items: {
          type: 'object[]',
          description: 'Foods the saved meal holds',
          properties: {
            foodId: { type: 'string', required: true, description: 'Food identifier' },
            nutrients: {
              type: 'object',
              required: true,
              description: 'Nutrient vector of this item',
              properties: {
                calories: { type: 'number', required: true, description: 'Energy in kcal' },
              },
            },
          },
        },
      },
    },
    {
      kind: 'list',
      fields: { q: { type: 'string', description: 'Name filter' } },
    },
  ],
};

/** A `list` op of the shape a malformed module could declare: the query kind keeps flat types. */
const nestedFilterRegistry: ResourceRegistry = {
  name: 'saved-meals',
  basePath: '/api/saved-meals',
  ops: [
    {
      kind: 'list',
      fields: {
        nutrients: {
          type: 'object',
          description: 'Nutrient vector used as a filter',
          properties: {
            calories: { type: 'number', required: true, description: 'Energy in kcal' },
          },
        },
      },
    },
  ],
};
describe('the nested values a body carries', () => {
  const nutrients = { calories: 400 };
  const items = [{ foodId: 'f1', nutrients: { calories: 90 } }];

  it('passes an object and an array of objects through unchanged', () => {
    expect(wireFor(mealRegistry, 'create', { name: 'a', nutrients, items }).body).toEqual({
      name: 'a',
      nutrients,
      items,
    });
  });

  it('keeps the two-level nesting intact', () => {
    const body = wireFor(mealRegistry, 'create', { name: 'a', nutrients, items }).body as Record<
      string,
      Array<Record<string, unknown>>
    >;

    expect(body['items'][0]['nutrients']).toEqual({ calories: 90 });
  });

  it('refuses a nested list filter at the derivation boundary, before any request exists', () => {
    expect(() => deriveInputSchema(nestedFilterRegistry, 'list')).toThrow(
      'nutrients: object on a query op',
    );
    expect(() => validateInput(nestedFilterRegistry.ops[0], { nutrients })).toThrow(
      'nutrients: object on a query op',
    );
  });

  it('leaves a flat list query unchanged', () => {
    expect(wireFor(mealRegistry, 'list', { q: 'oats' }).query).toEqual({ q: 'oats' });
  });
});

describe('the nested shapes the derived schema advertises', () => {
  it('describes the object field by its declared keys', () => {
    expect(deriveInputSchema(mealRegistry, 'create').properties['nutrients']).toEqual({
      type: 'object',
      properties: { calories: { type: 'number', description: 'Energy in kcal' } },
      required: ['calories'],
      additionalProperties: false,
      description: 'Nutrient vector',
    });
  });

  it('wraps the array-of-object field in an array of that object shape', () => {
    expect(deriveInputSchema(mealRegistry, 'create').properties['items']).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          foodId: { type: 'string', description: 'Food identifier' },
          nutrients: {
            type: 'object',
            properties: { calories: { type: 'number', description: 'Energy in kcal' } },
            required: ['calories'],
            additionalProperties: false,
            description: 'Nutrient vector of this item',
          },
        },
        required: ['foodId', 'nutrients'],
        additionalProperties: false,
      },
      description: 'Foods the saved meal holds',
    });
  });

  it('agrees with the validator on a nested value of the wrong type', () => {
    const operation = findOp(mealRegistry, 'create');
    const supplied = { name: 'a', nutrients: { calories: 'many' } };
    const schema = deriveInputSchema(mealRegistry, 'create');

    expect(validateInput(operation, supplied)).toEqual([
      { field: 'nutrients.calories', reason: 'expected number' },
    ]);
    expect(accepts(schema, supplied)).toBe(false);
    expect(accepts(schema, { name: 'a', nutrients: { calories: 400 } })).toBe(true);
  });
});
