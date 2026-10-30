/**
 * `feedback` service module (SPEC-ops-all-services §1.6): one `feedback` resource
 * mirroring `apps/feedback-service` route for route — the listing, the submission,
 * and the status change. Both adapters render this registry, so the feedback route
 * shape lives here alone.
 *
 * `id` is a plain string and stays one: the server parses it with `ParseUUIDPipe`
 * and answers `400` for a malformed value (`update-feedback-status.dto.ts`, the
 * route's only validation status). A local copy of the UUID pattern would be a
 * second rule free to drift from the one the service enforces.
 *
 * The two closed vocabularies a submission carries are spelled out rather than
 * imported, in `@life/shared`'s declared order (`packages/shared/src/index.ts:176-193`,
 * which owns them): `@life/ops` declares no dependency on `@life/shared`, so
 * `feedback-parity.test.ts` is what holds these lists to the ones the DTO validates
 * against — the same division `meal.ts` uses for the nutrient keys.
 */
import type { ServiceModule } from '../cli/run';
import { defineResource } from '../core/registry';

/**
 * The status vocabulary `@life/shared` owns (`FEEDBACK_STATUS_VALUES`), written in
 * its order so the descriptor carries the same list the DTO validates against.
 */
const FEEDBACK_STATUS_VALUES = ['open', 'in_progress', 'done', 'wont_do'] as const;

/** The apps a submission may name, in `FEEDBACK_APPS` order. */
const FEEDBACK_APPS = ['notes', 'todos', 'meals', 'pomodoro', 'feedback'] as const;

/** The kinds of report a submission may carry, in `FEEDBACK_TYPE_VALUES` order. */
const FEEDBACK_TYPE_VALUES = ['feature_request', 'enhancement', 'bug_report'] as const;

export const service: ServiceModule = {
  registry: defineResource({
    name: 'feedback',
    basePath: '/api/feedback',
    ops: [
      { kind: 'list', fields: {} },

      {
        kind: 'create',
        fields: {
          id: {
            type: 'string',
            required: true,
            description:
              'Client-supplied UUIDv4 idempotency key, not a database-generated id: the ' +
              'encrypted envelope’s AAD binds it, so a repeated id is a no-op returning the same row',
          },
          app: {
            type: 'string',
            required: true,
            enum: FEEDBACK_APPS,
            description: `App the feedback is about, one of ${FEEDBACK_APPS.join(', ')}`,
          },
          type: {
            type: 'string',
            required: true,
            enum: FEEDBACK_TYPE_VALUES,
            description: `Kind of report, one of ${FEEDBACK_TYPE_VALUES.join(', ')}`,
          },
          title: {
            type: 'string',
            required: true,
            description: 'Feedback title, at most 200 characters',
          },
          description: {
            type: 'string',
            required: true,
            description: 'Feedback text, at most 2000 characters',
          },
        },
      },

      {
        kind: 'update',
        fields: {
          id: {
            type: 'string',
            required: true,
            description: 'Identifier of the feedback row to restatus; the service parses it as a UUIDv4',
          },
          status: {
            type: 'string',
            required: true,
            enum: FEEDBACK_STATUS_VALUES,
            description: `New status, one of ${FEEDBACK_STATUS_VALUES.join(', ')}`,
          },
        },
      },
    ],
  }),
};
