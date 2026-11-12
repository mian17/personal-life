import type { MealGroup } from '../entries/dto/create-entry.dto.js';

/**
 * The payloads meal-service owes todo-service, as pure functions — no I/O, no
 * clock, no repository. `docs/roadmap/research/outbox-atomicity.md` §1 keeps the
 * shape here and the decision in `MealTodoProducerService`, so a payload can be
 * asserted without a database and a producer can change its mind without
 * touching the wire form.
 *
 * Every function takes `today` from its caller. The day is always the client's,
 * never this process's (lesson 0019), so nothing below reads `Date.now()`.
 */

/** The meal groups that earn a daily task; `snack` does not (it has no rhythm). */
export const TODO_GROUPS = ['breakfast', 'lunch', 'dinner'] as const;

/** One group this service produces tasks for. */
export type TodoGroup = (typeof TODO_GROUPS)[number];

/** Logical destination for a create intent (`Outbox.destination`, not a URL). */
export const TODOS_CREATE = 'todos.create';

/** Logical destination for a tick intent. */
export const TODOS_COMPLETE = 'todos.complete';

/**
 * The origin this service writes under, and the path it grants itself through.
 *
 * Both are stated once here: the origin is the value `POST /api/todos/origin-grant`
 * is asked for, and the path is that route's own spelling. A producer that
 * hard-coded either at its call site would be a second opinion about a fact that
 * belongs to one place.
 */
export const MEAL_ORIGIN_SERVICE = 'meal-service';
export const ORIGIN_GRANT_PATH = '/api/todos/origin-grant';

/** `POST /api/todos/origin` body — the create-by-origin route's shape. */
export interface CreateIntent {
  title: string;
  originId: string;
  repeat: 'daily';
  dueDate: string;
}

/** `POST /api/todos/origin/:originId/complete` body, plus the task it means. */
export interface TickIntent {
  title: string;
  occurrence: string;
  /**
   * The task to tick. It travels *inside* the body because the BFF does the
   * delivering and has no other way to know which todo a bare tick names — the
   * route's own path parameter is built from this value.
   */
  originId: string;
}

/**
 * The producer's own id for one group's todo: `meal:<group>`.
 *
 * Stable across days on purpose. todo-service's `(ownerSub, originService,
 * originId)` unique index means one row per group forever, so a redelivered
 * create answers 409 instead of making a second task, and nothing accumulates
 * as days pass.
 */
export function originIdForGroup(group: TodoGroup): string {
  return `meal:${group}`;
}

/** `Eat Breakfast to reach 2200 kcal` — the group capitalised, the target a whole number. */
export function titleForGroup(group: TodoGroup, calories: number): string {
  return `Eat ${capitalise(group)} to reach ${Math.round(calories)} kcal`;
}

/** The create intent for one group on one day. */
export function createIntent(group: TodoGroup, calories: number, today: string): CreateIntent {
  return {
    title: titleForGroup(group, calories),
    originId: originIdForGroup(group),
    repeat: 'daily',
    dueDate: today,
  };
}

/**
 * The tick intent for one group on one day.
 *
 * It carries the title as well as the pin, so the tick does two jobs in one
 * call: it logs the day's task and it refreshes the task's calorie number in
 * place. Without the title a changed target reaches the todo row only when a
 * create happens to be re-enqueued, which leaves the user a stale goal. The
 * same `titleForGroup` sentence is used as on the create, so the two intents
 * can never disagree.
 *
 * The occurrence pin is what makes a redelivered tick safe: todo-service logs
 * the named occurrence and answers "already logged" as a no-op, so a second
 * delivery advances nothing. An unpinned tick would tick whatever is currently
 * due and walk the task a day forward per delivery — the one failure the pin
 * exists to prevent (`SPEC-todo-origin` §9.16).
 */
export function tickIntent(group: TodoGroup, calories: number, today: string): TickIntent {
  return {
    title: titleForGroup(group, calories),
    occurrence: today,
    originId: originIdForGroup(group),
  };
}

/** Whether a logged entry's group has a task to tick. */
export function isTodoGroup(group: MealGroup): group is TodoGroup {
  return (TODO_GROUPS as readonly string[]).includes(group);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
