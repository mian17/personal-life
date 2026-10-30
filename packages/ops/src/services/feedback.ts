/**
 * `feedback` service module (SPEC-ops-all-services §1.6): one `feedback` resource
 * mirroring `apps/feedback-service` route for route — the listing, and the status
 * change. Both adapters render this registry, so the feedback route shape lives
 * here alone.
 *
 * `POST /api/feedback` is absent (spec §1.7, Open Question 10.1): the service takes
 * a client-generated UUIDv4 `id`, and no closed field vocabulary can constrain one,
 * so the intent's 36-route total only holds with that route cut.
 *
 * `id` is a plain string and stays one: the server parses it with `ParseUUIDPipe`
 * and answers `400` for a malformed value (`update-feedback-status.dto.ts`, the
 * route's only validation status). A local copy of the UUID pattern would be a
 * second rule free to drift from the one the service enforces.
 */
import type { ServiceModule } from '../cli/run';
import { defineResource } from '../core/registry';

/**
 * The status vocabulary `@life/shared` owns (`FEEDBACK_STATUS_VALUES`), written in
 * its order so the descriptor carries the same list the DTO validates against.
 */
const FEEDBACK_STATUS_VALUES = ['open', 'in_progress', 'done', 'wont_do'] as const;

export const service: ServiceModule = {
  registry: defineResource({
    name: 'feedback',
    basePath: '/api/feedback',
    ops: [
      { kind: 'list', fields: {} },

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
