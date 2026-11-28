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
  return nearestGridStep(bounded);
}

/** The 15-minute grid value closest to `minutes`; the bounds are applied first. */
function nearestGridStep(minutes: number): number {
  return Math.round(minutes / GOAL_STEP_MINUTES) * GOAL_STEP_MINUTES;
}
