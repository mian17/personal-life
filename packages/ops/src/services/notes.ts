/**
 * The `notes` service module (SPEC-ops-notes-service §1.1): one `defineResource`
 * call that mirrors the `note-service` HTTP contract field for field. Both
 * adapters render this registry, so this file is the only place the notes route
 * shape lives — the CLI and the MCP server restate none of it (SPEC.md §3).
 *
 * The module states the service-side contract and nothing more. Domain bounds
 * stay server-enforced (`body` ≤ 20000 characters, `tagId` ≥ 1, `limit` 1–200),
 * and so does the `409` a stale `expectedVersion` raises.
 *
 * Two routes are deliberately absent (spec §7, §9.7):
 * `POST /api/notes/:id/permanent` and `DELETE /api/notes/trash`. Both destroy
 * rows in bulk, which belongs on the human checklist rather than an agent's
 * single call.
 */
import type { ServiceModule } from '../cli/run.js';
import { defineResource } from '../core/registry.js';

export const service: ServiceModule = {
  registry: defineResource({
    name: 'notes',
    basePath: '/api/notes',
    ops: [
      {
        kind: 'create',
        fields: {
          body: {
            type: 'string',
            required: true,
            description: 'Note text, at most 20000 characters',
          },
          tagIds: {
            type: 'number[]',
            description: 'Tag ids to attach; omitting it leaves the note untagged',
          },
        },
      },

      {
        kind: 'get',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the note to read',
          },
        },
      },

      {
        kind: 'list',
        fields: {
          tagId: {
            type: 'number',
            description: 'Only notes carrying this tag id',
          },
          q: {
            type: 'string',
            description: 'Only notes whose text matches this search, at most 200 characters',
          },
          limit: {
            type: 'number',
            description: 'Page size, 1 to 200 notes',
          },
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
            type: 'string',
            required: true,
            description: 'Identifier of the note to patch',
          },
          body: {
            type: 'string',
            description: 'Replacement text, at most 20000 characters',
          },
          tagIds: {
            type: 'number[]',
            description: 'Replacement tag set; omitting it leaves the current tags attached',
          },
          expectedVersion: {
            type: 'number',
            description: 'Version the caller last saw; a stale value fails with 409',
          },
        },
      },

      {
        kind: 'delete',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the note to move to the trash',
          },
        },
      },

      {
        kind: 'restore',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the trashed note to bring back',
          },
        },
      },
    ],
  }),
};
