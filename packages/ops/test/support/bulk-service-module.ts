/**
 * The bulk fixture registry (SPEC-bulk-ops §7): what `LIFE_OPS_SERVICE` points at
 * when a suite drives the derived kinds through an adapter. Three resources
 * answer the three opt-in cases — fully opted in over every source kind, not
 * opted in at all, and opted in with `delete` as its only source gap — so one
 * module serves every bulk suite.
 */
import { defineResource } from '../../src/core/registry.js';
import type { OpSpec, ResourceRegistry } from '../../src/core/types.js';

const singleRowOps: OpSpec[] = [
  {
    kind: 'create',
    fields: {
      title: { type: 'string', required: true, description: 'Title of the entry' },
      body: { type: 'string', description: 'Text of the entry' },
    },
  },
  {
    kind: 'get',
    fields: {
      id: { type: 'string', required: true, description: 'Identifier of the entry' },
    },
  },
  {
    kind: 'list',
    fields: {
      cursor: { type: 'string', description: 'Opaque page cursor from the last listing' },
    },
  },
  {
    kind: 'update',
    fields: {
      id: { type: 'string', required: true, description: 'Identifier of the entry' },
      title: { type: 'string', description: 'Replacement title' },
      body: { type: 'string', description: 'Replacement text' },
    },
  },
  {
    kind: 'delete',
    fields: {
      id: { type: 'string', required: true, description: 'Identifier of the entry' },
    },
  },
];

const opsWithoutDelete = singleRowOps.filter((operation) => operation.kind !== 'delete');

/** Opted in over every source kind, so all four bulk kinds derive. */
const journals = defineResource({
  name: 'journals',
  basePath: '/api/journals',
  ops: singleRowOps,
  bulk: true,
});

/** The same ops with no opt-in, so this resource holds no bulk kind at all. */
const entries = defineResource({ name: 'entries', basePath: '/api/entries', ops: singleRowOps });

/** Opted in with no `delete` to fan out over, so `deleteMany` cannot derive. */
const drafts = defineResource({
  name: 'drafts',
  basePath: '/api/drafts',
  ops: opsWithoutDelete,
  bulk: true,
});

export const resources: ResourceRegistry[] = [journals, entries, drafts];
