import type { MealGroup } from '../../entries/dto/create-entry.dto.js';

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

/** `POST /api/todos/origin` body — the create-by-origin route's shape. */
export interface CreateIntent {
  title: string;
  originId: string;
  repeat: 'daily';
  dueDate: string;
}

/** `POST /api/todos/origin/:originId/complete` body. */
export interface TickIntent {
  occurrence: string;
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
 * The occurrence pin is what makes a redelivered tick safe: todo-service logs
 * the named occurrence and answers "already logged" as a no-op, so a second
 * delivery advances nothing. An unpinned tick would tick whatever is currently
 * due and walk the task a day forward per delivery — the one failure the pin
 * exists to prevent (`SPEC-todo-origin` §9.16).
 */
export function tickIntent(group: TodoGroup, today: string): TickIntent {
  return { occurrence: today };
}

/** Whether a logged entry's group has a task to tick. */
export function isTodoGroup(group: MealGroup): group is TodoGroup {
  return (TODO_GROUPS as readonly string[]).includes(group);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
