/**
 * The sample registry (SPEC.md §3, §7): the in-package stand-in for a future
 * per-service module. It covers the whole closed CRUD set and exercises every
 * `FieldSpec` type, so the suites prove the contract on this registry alone
 * and no test ever contacts a real service.
 */
import { defineResource } from '../core/registry';
import type { ResourceRegistry } from '../core/types';

export const sampleRegistry: ResourceRegistry = defineResource({
  name: 'sample',
  basePath: '/samples',
  ops: [
    {
      kind: 'create',
      fields: {
        title: { type: 'string', required: true, description: 'Human title of the sample' },
        priority: { type: 'number', description: 'Ordering weight, higher sorts first' },
        archived: { type: 'boolean', description: 'Whether the sample starts archived' },
        labels: { type: 'string[]', description: 'Free-form labels attached at creation' },
      },
    },
    {
      kind: 'get',
      fields: {
        id: { type: 'string', required: true, description: 'Identifier of the sample to read' },
      },
    },
    {
      kind: 'list',
      fields: {
        cursor: { type: 'string', description: 'Opaque page cursor from the previous listing' },
        limit: { type: 'number', description: 'Maximum samples to return in one page' },
        includeArchived: {
          type: 'boolean',
          description: 'Whether archived samples appear in the listing',
        },
      },
    },
    {
      kind: 'update',
      fields: {
        id: { type: 'string', required: true, description: 'Identifier of the sample to patch' },
        title: { type: 'string', description: 'Replacement title' },
        priority: { type: 'number', description: 'Replacement ordering weight' },
        archived: { type: 'boolean', description: 'Replacement archived flag' },
        labels: { type: 'string[]', description: 'Replacement label set' },
        expectedVersion: {
          type: 'number',
          description: 'Version the caller last saw; a stale value fails with 409',
        },
      },
    },
    {
      kind: 'delete',
      fields: {
        id: { type: 'string', required: true, description: 'Identifier of the sample to remove' },
      },
    },
  ],
});
