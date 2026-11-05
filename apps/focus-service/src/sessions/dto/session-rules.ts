/**
 * The two rules the session boundary enforces, written once and imported by every
 * DTO that has to know them (`SPEC-focus-service` §1 wire contract, §9.2).
 *
 * Effort arrives as whole minutes, never seconds: the recorder floors at the client
 * seam, so a sub-minute block never reaches this service to be refused.
 */

/** Client-local day, `YYYY-MM-DD` and nothing else. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A day string is exactly ten characters; the regex is the shape rule, this the cap. */
export const SESSION_DATE_MAX = 10;

/** Both bounds inclusive: `0` is a discarded block, `181` is an impossible one. */
export const MINUTES_RANGE = { min: 1, max: 180 } as const;

/**
 * A daily goal is a whole day's focus total, not one block's minutes, so it is bounded by a
 * day rather than by `MINUTES_RANGE`: every whole minute a day can hold is a goal.
 */
export const DAILY_GOAL_RANGE = { min: 1, max: 1440 } as const;
