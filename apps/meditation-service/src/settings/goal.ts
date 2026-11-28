/**
 * The daily-goal grid (`SPEC-meditation-app` §1): default 15 minutes, step 15,
 * clamped 15–480. Fifteens on purpose — a step of 15 from a minimum of 5 would walk
 * 5, 20, 35 and never land on the values the app offers.
 */
export const DEFAULT_GOAL_MINUTES = 15;
export const GOAL_MIN_MINUTES = 15;
export const GOAL_MAX_MINUTES = 480;
export const GOAL_STEP_MINUTES = 15;

/**
 * The goal as it is stored: inside 15–480 and on the 15-minute grid. Out-of-range
 * values are clamped rather than refused — the goal is a knob, not a contract — so
 * 7 reads back as 15 and 495 as 480.
 */
export function clampGoal(goalMinutes: number): number {
  const bounded = Math.min(Math.max(goalMinutes, GOAL_MIN_MINUTES), GOAL_MAX_MINUTES);
  return nearestGridStep(bounded, GOAL_STEP_MINUTES);
}

/** The grid value closest to `minutes` on a `step`-minute grid; the bounds are applied first. */
function nearestGridStep(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

/**
 * The sitting length's own range: 5 minutes to a day, on a 5-minute grid. Five, not ten, because
 * the 15-minute default has to stay storable and every ±10 step from it has to land on a value the
 * service will keep: 15 → 5 or 25, both on this grid and both inside its bounds.
 */
export const PLANNED_MIN_MINUTES = 5;
export const PLANNED_MAX_MINUTES = 1440;
export const PLANNED_STEP_MINUTES = 5;

/**
 * The planned length as it is stored: inside 5–1440 and on the 5-minute grid. Clamped rather than
 * refused, the same way the goal is — a length is a knob, not a contract.
 */
export function clampPlannedMinutes(minutes: number): number {
  const bounded = Math.min(Math.max(minutes, PLANNED_MIN_MINUTES), PLANNED_MAX_MINUTES);
  return nearestGridStep(bounded, PLANNED_STEP_MINUTES);
}
