import {
  DEFAULT_GOAL_MINUTES,
  GOAL_MAX_MINUTES,
  GOAL_MIN_MINUTES,
  GOAL_STEP_MINUTES,
  PLANNED_MAX_MINUTES,
  PLANNED_MIN_MINUTES,
  PLANNED_STEP_MINUTES,
  clampGoal,
  clampPlannedMinutes,
} from '../src/settings/goal.js';

/**
 * The goal grid (`SPEC-meditation-app` §1): default 15, step 15, clamped 15–480.
 * Every bound is asserted at its exact edge value — the clamp is the only thing
 * standing between a stored goal and a goal the app cannot render.
 */
describe('clampGoal', () => {
  it('starts a fresh owner at fifteen minutes', () => {
    expect(DEFAULT_GOAL_MINUTES).toBe(15);
    expect(clampGoal(DEFAULT_GOAL_MINUTES)).toBe(15);
  });

  it('lifts a goal below the floor to the floor', () => {
    expect(clampGoal(7)).toBe(GOAL_MIN_MINUTES);
    expect(clampGoal(0)).toBe(GOAL_MIN_MINUTES);
    expect(clampGoal(-30)).toBe(GOAL_MIN_MINUTES);
  });

  it('pulls a goal above the ceiling back to the ceiling', () => {
    expect(clampGoal(495)).toBe(GOAL_MAX_MINUTES);
    expect(clampGoal(10_000)).toBe(GOAL_MAX_MINUTES);
  });

  it('keeps both bounds exactly as given', () => {
    expect(clampGoal(GOAL_MIN_MINUTES)).toBe(15);
    expect(clampGoal(GOAL_MAX_MINUTES)).toBe(480);
  });

  it('lands a non-grid value on the nearest fifteen-minute step', () => {
    expect(clampGoal(22)).toBe(15);
    expect(clampGoal(23)).toBe(30);
    expect(clampGoal(37)).toBe(30);
    expect(clampGoal(38)).toBe(45);
    expect(clampGoal(200)).toBe(195);
  });

  it('leaves a grid value untouched', () => {
    for (
      let minutes = GOAL_MIN_MINUTES;
      minutes <= GOAL_MAX_MINUTES;
      minutes += GOAL_STEP_MINUTES
    ) {
      expect(clampGoal(minutes)).toBe(minutes);
    }
  });
});

/**
 * The sitting-length grid: 5–1440 on fives, so the fifteen-minute default stays storable and a
 * ten-minute step from it lands on a value the service keeps.
 */
describe('clampPlannedMinutes', () => {
  it('clamps into five minutes to a day', () => {
    expect(clampPlannedMinutes(PLANNED_MIN_MINUTES)).toBe(5);
    expect(clampPlannedMinutes(0)).toBe(PLANNED_MIN_MINUTES);
    expect(clampPlannedMinutes(PLANNED_MAX_MINUTES)).toBe(1440);
    expect(clampPlannedMinutes(10_000)).toBe(PLANNED_MAX_MINUTES);
  });

  it('lands a non-grid value on the nearest five-minute step', () => {
    expect(clampPlannedMinutes(17)).toBe(15);
    expect(clampPlannedMinutes(18)).toBe(20);
  });

  it('starts a fresh owner at the goal default and keeps every ten-minute step from it', () => {
    expect(clampPlannedMinutes(DEFAULT_GOAL_MINUTES)).toBe(DEFAULT_GOAL_MINUTES);
    expect(clampPlannedMinutes(DEFAULT_GOAL_MINUTES - 10)).toBe(5);
    expect(clampPlannedMinutes(DEFAULT_GOAL_MINUTES + 10)).toBe(25);
    expect(PLANNED_STEP_MINUTES).toBe(5);
  });
});
