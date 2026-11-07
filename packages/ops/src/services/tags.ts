/**
 * The `tags` service module (SPEC-ops-all-services §1.4, §9.8): two resources
 * mirroring `apps/tags-service` route for route — `tags` with three routes and
 * `tags-resolve` with the one read it serves. Both adapters render this registry,
 * so the tag route shape lives here alone.
 *
 * A rename addresses a numeric id, which `wire.ts` stringifies: the request is
 * `PATCH /api/tags/7` and its body carries the rename alone. A create answers 201
 * for a new name and 200 for one the owner already has; the executor renders the
 * body it received either way, so that split never reaches the output.
 *
 * `tags-resolve` is a pure read wearing the `create` kind, because the closed kind
 * set names the request shape rather than the caller's intent. That mislabel is why
 * it alone opts out of the kind's destructiveness default: as a write it would demand
 * human approval before an agent could read back the names of tags it already knows.
 *
 * `DELETE /api/tags/:id` is absent by policy (spec §1.7). The tag vocabulary is
 * shared across apps, so destroying one entry detaches todo rows other apps still
 * point at — a human checklist action, never one agent call. Service bounds stay
 * server-enforced (`name` at most 50 characters, ids integers) and so does the
 * `409` a stale `expectedVersion` raises.
 */
import { defineResource } from '../core/registry';
import type { ResourceRegistry } from '../core/types';

export const resources: ResourceRegistry[] = [
  defineResource({
    name: 'tags',
    basePath: '/api/tags',
    ops: [
      {
        kind: 'create',
        fields: {
          name: {
            type: 'string',
            required: true,
            description: 'Tag name, at most 50 characters; an existing name returns its tag',
          },
        },
      },

      {
        kind: 'list',
        fields: {
          limit: { type: 'number', description: 'Page size, 1 to 200 tags' },
          cursor: {
            type: 'string',
            description: 'Opaque cursor the previous page returned; passed back untouched',
          },
        },
      },

      {
        kind: 'update',
        fields: {
          id: {
            type: 'number',
            required: true,
            description: 'Numeric id of the tag to rename; the path carries it as text',
          },
          name: {
            type: 'string',
            required: true,
            description: 'Replacement name, at most 50 characters',
          },
          expectedVersion: {
            type: 'number',
            description: 'Version the caller last saw; a stale value fails with 409',
          },
        },
      },
    ],
  }),

  defineResource({
    name: 'tags-resolve',
    basePath: '/api/tags/resolve',
    ops: [
      {
        kind: 'create',
        isDestructive: false,
        fields: {
          ids: {
            type: 'number[]',
            required: true,
            description: 'Numeric tag ids to resolve; the service omits any id it does not own',
          },
        },
      },
    ],
  }),
];
