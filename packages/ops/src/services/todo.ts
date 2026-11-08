/**
 * The `todo` service module (SPEC-ops-all-services §1.2): five resources mirroring
 * `apps/todo-service` route for route — `todos` with six routes, one listing each
 * for `todos-tags`, `todos-trash`, and `todos-completions`, and `lists` with three.
 * Both adapters render this registry, so the todo route shape lives here alone.
 *
 * The service owns every domain bound (`title` ≤ 500 characters, notes ≤ 20000,
 * list names ≤ 100, weekday numbers 1 to 7, the `ISO_DUE` form) and the `409` a
 * stale `expectedVersion` raises; this module states the request shape and
 * nothing more.
 *
 * Three cuts are deliberate (spec §1.7, §9.4): no `DELETE /api/lists/:id`, because
 * detaching every todo of a shared list belongs on the human checklist; no `push`
 * resource, whose three routes are browser plumbing; and no null-means-clear path,
 * so an absent field is simply not sent and no field ever accepts `null`.
 */
import { defineResource } from '../core/registry';
import type { FieldSpec, ResourceRegistry } from '../core/types';

export const resources: ResourceRegistry[] = [
  defineResource({
    name: 'todos',
    basePath: '/api/todos',
    ops: [
      {
        kind: 'create',
        fields: {
          title: {
            type: 'string',
            required: true,
            description: 'Todo text, at most 500 characters',
          },
          ...todoDetails(),
        },
      },

      { kind: 'list', fields: todoFilters() },

      {
        kind: 'get',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the todo to read',
          },
        },
      },

      {
        kind: 'update',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the todo to patch',
          },
          title: {
            type: 'string',
            description: 'Replacement todo text, at most 500 characters',
          },
          done: { type: 'boolean', description: 'Whether the todo is complete' },
          ...todoDetails(),
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
            description: 'Identifier of the todo to move to the trash',
          },
        },
      },

      {
        kind: 'restore',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the trashed todo to bring back',
          },
        },
      },
    ],
  }),

  defineResource({
    name: 'todos-tags',
    basePath: '/api/todos/tags',
    ops: [{ kind: 'list', fields: {} }],
  }),

  defineResource({
    name: 'todos-trash',
    basePath: '/api/todos/trash',
    ops: [{ kind: 'list', fields: pageWindow() }],
  }),

  defineResource({
    name: 'todos-completions',
    basePath: '/api/todos/completions',
    ops: [{ kind: 'list', fields: pageWindow() }],
  }),

  defineResource({
    name: 'lists',
    basePath: '/api/lists',
    ops: [
      { kind: 'create', fields: listDetails() },

      {
        kind: 'list',
        fields: {
          q: {
            type: 'string',
            description: 'Only lists whose name matches this search, at most 200 characters',
          },
          ...pageWindow(),
        },
      },

      {
        kind: 'update',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the list to rename or re-default',
          },
          ...listDetails(),
          expectedVersion: {
            type: 'number',
            description: 'Version the caller last saw; a stale value fails with 409',
          },
        },
      },
    ],
  }),
];

/** Everything a todo carries besides its text; `create` sets it, `update` replaces it. */
function todoDetails(): Record<string, FieldSpec> {
  return {
    note: { type: 'string', description: 'Free-form note, at most 20000 characters' },
    dueDate: {
      type: 'string',
      description:
        'Due moment in the `ISO_DUE` form: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when it carries a time',
    },
    repeat: {
      type: 'string',
      enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'],
      description:
        'Repeat rule, one of `TODO_REPEATS`: daily, weekdays, weekly, monthly, yearly, or custom',
    },
    repeatDays: {
      type: 'number[]',
      description: 'Weekday numbers, ISO 1 to 7, a custom repeat fires on',
    },
    listId: { type: 'string', description: 'Identifier of the list this todo belongs to' },
    important: {
      type: 'boolean',
      description: 'Whether the todo is important; omitting it inherits the list default',
    },
    tagIds: { type: 'number[]', description: 'Tag ids to attach to this todo' },
  };
}

/** The `todos` listing filters; every supplied one travels as a query parameter. */
function todoFilters(): Record<string, FieldSpec> {
  return {
    q: {
      type: 'string',
      description: 'Only todos whose title or note matches this search, at most 200 characters',
    },
    listId: { type: 'string', description: 'Only todos belonging to this list' },
    tagId: { type: 'number', description: 'Only todos carrying this tag id' },
    done: { type: 'boolean', description: 'Only todos in this done state' },
    important: {
      type: 'boolean',
      description: 'Only todos whose effective importance, inherited included, matches',
    },
    dueBefore: { type: 'string', description: 'Only todos due on or before this `YYYY-MM-DD`' },
    dueAfter: { type: 'string', description: 'Only todos due on or after this `YYYY-MM-DD`' },
    ...pageWindow(),
  };
}

/** One page of a todo listing: how many, and where the page starts. */
function pageWindow(): Record<string, FieldSpec> {
  return {
    limit: { type: 'number', description: 'Page size, 1 to 200 todos' },
    cursor: {
      type: 'string',
      description: 'Opaque cursor the previous page returned; passed back untouched',
    },
  };
}

/** The `lists` payload a create sends and an update replaces. */
function listDetails(): Record<string, FieldSpec> {
  return {
    name: {
      type: 'string',
      required: true,
      description: 'List name, at most 100 characters',
    },
    importantDefault: {
      type: 'boolean',
      description: 'Whether todos in this list are important by default',
    },
  };
}
