import { IsIn, IsString } from 'class-validator';
import {
  FOCUS_TODO_DISCLOSURE,
  MEAL_TODO_DISCLOSURE,
  type GrantDirection,
  type GrantScope,
} from '@life/service-kit';

/**
 * The origins a user may grant themselves through `POST /api/todos/origin-grant`
 * (`SPEC-todo-origin` assumption 12).
 *
 * A closed set, not a free string: without it the route would be a general "grant
 * me anything" hole, since todo-service stamps whatever origin the body names onto
 * the caller's own row. A value outside this set is a 400 naming the set, so
 * widening it is a deliberate edit here rather than a request the service happens
 * to accept.
 *
 * The grantee is not on this list and cannot be: it is the verified `client_id` of
 * the caller's own token, so a self-service grant can only ever name the client
 * that is actually asking.
 */
export const SELF_SERVICE_ORIGINS = ['meal-service', 'focus-service'] as const;

/** One origin a user may grant themselves. */
export type SelfServiceOrigin = (typeof SELF_SERVICE_ORIGINS)[number];

/**
 * What each origin's grant allows. This table — not the request — is where the
 * direction and the read scope come from.
 *
 * That is the whole defence of the route. A body carrying `direction` or `scope`
 * would let the caller grant itself `all` when the screen offered something
 * narrower, which is the escalation hole this route already closed once for
 * `clientId`; so neither has a field on the DTO and the global
 * `forbidNonWhitelisted` pipe refuses them. The origin names the capability:
 * `meal-service` writes (`write`, no scope — a write grant is scoped by its
 * origin), `focus-service` reads every open task (`read`/`all`) because a focus
 * session is started from the whole list, not from one producer's rows.
 */
export const SELF_SERVICE_GRANT: Record<
  SelfServiceOrigin,
  { direction: GrantDirection; scope: GrantScope | null }
> = {
  'meal-service': { direction: 'write', scope: null },
  'focus-service': { direction: 'read', scope: 'all' },
};

/**
 * The sentence each self-service origin records, keyed by origin so the message
 * cannot drift from the permission it describes: the body names an origin, and
 * this table says which sentence that origin's consent screen showed. The string
 * itself lives in `@life/service-kit` beside `OriginGrant`, because the row stores
 * it verbatim and each producer app stores the same value on its own toggle.
 */
export const SELF_SERVICE_DISCLOSURE: Record<SelfServiceOrigin, string> = {
  'meal-service': MEAL_TODO_DISCLOSURE,
  'focus-service': FOCUS_TODO_DISCLOSURE,
};

/**
 * Body of `POST /api/todos/origin-grant`.
 *
 * One field, because everything else is identity or policy: `ownerSub` comes from
 * the token's `sub`, `clientId` from its verified `client_id`, and the direction
 * and scope from {@link SELF_SERVICE_GRANT}. None of the four has a field here, so
 * the global `forbidNonWhitelisted` pipe rejects a body declaring any of them — a
 * self-service route that accepted a `clientId` would let any signed-in user hand
 * any producer app write access to their account, and one that accepted a
 * `direction` would let it hand out a capability the screen never offered.
 *
 * The disclosure is not a field either: it comes from
 * {@link SELF_SERVICE_DISCLOSURE}, so the stored sentence is never a value the
 * caller chose.
 */
export class GrantOwnOriginDto {
  /** The origin this grant is scoped to; one of `SELF_SERVICE_ORIGINS`. */
  @IsString()
  @IsIn(SELF_SERVICE_ORIGINS, {
    message: `originService must be one of: ${SELF_SERVICE_ORIGINS.join(', ')}`,
  })
  originService: SelfServiceOrigin;
}
