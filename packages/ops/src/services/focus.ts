/**
 * `focus` service module (SPEC-ops-all-services §1.5): two resources mirroring
 * `apps/focus-service` route for route — `goal` one read, `sessions` the pair a
 * recorder writes and a report reads back. Both adapters render the registry, so
 * the focus route shape lives here alone.
 *
 * `PUT /api/goal` is absent (spec §1.7): a human replaces a day's goal, and no
 * single agent call may rewrite the target someone set for themselves. Reading it
 * stays, because a recorded plan is only comparable to the goal it was measured
 * against.
 *
 * The session listing carries `from` and `to` as required query parameters — the
 * range is part of the fetch identity, so the service never defaults it. Both
 * listings also carry the shared paging window (`limit`/`cursor`), whose
 * descriptions copy the seam's cap because this package takes no dependency on
 * `@life/service-kit`: parity pins the number instead of importing it.
 * `minutes`
 * arrives whole and unbounded here: the service owns the recorded 1–180 bound
 * (§9.13), and a second copy in this package would be a bound that can drift.
 */
import { defineResource } from '../core/registry.js';
import type { FieldSpec, ResourceRegistry } from '../core/types.js';

export const resources: ResourceRegistry[] = [
  defineResource({
    name: 'goal',
    basePath: '/api/goal',
    ops: [
      {
        kind: 'list',
        fields: {
          limit: { type: 'number', description: 'Page size, 1 to 200 goals' },
          cursor: {
            type: 'string',
            description: 'Opaque cursor the previous page returned; passed back untouched',
          },
        },
      },
    ],
  }),

  defineResource({
    name: 'sessions',
    basePath: '/api/sessions',
    ops: [
      {
        kind: 'create',
        fields: {
          date: sessionDay('the session is filed under'),
          minutes: {
            type: 'number',
            required: true,
            description: 'Whole minutes the session lasted; the service owns the bound',
          },
        },
      },

      {
        kind: 'list',
        fields: {
          from: sessionDay('the range starts on, inclusive, `YYYY-MM-DD`'),
          to: sessionDay('the range ends on, inclusive, `YYYY-MM-DD`'),
          limit: { type: 'number', description: 'Page size, 1 to 200 sessions' },
          cursor: {
            type: 'string',
            description: 'Opaque cursor the previous page returned; passed back untouched',
          },
        },
      },
    ],
  }),
];

/** One client-local day; the service never derives it from its own clock. */
function sessionDay(role: string): FieldSpec {
  return {
    type: 'string',
    required: true,
    description: `Client-local day ${role}, formatted \`YYYY-MM-DD\``,
  };
}
