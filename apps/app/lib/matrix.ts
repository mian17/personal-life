import { dueDay, dueDateLabel, dueDateState } from '@life/ui';
import type { ListItemTone, MatrixTone } from '@life/ui';
import type { Todo } from '@life/shared';

/**
 * Eisenhower matrix domain logic (`SPEC-matrix-ui`). Pure and app-owned:
 * importance comes from `Todo.effectiveImportant` as delivered (never recomputed
 * here), urgency is derived from `dueDate` via `@life/ui`'s timezone-safe date
 * helpers (lesson 0003) — no ISO parsing in the app.
 */

/** The four matrix cells; the id is also the quadrant's stable key. */
export type QuadrantId =
  | 'urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-important'
  | 'not-urgent-not-important';

/** The fixed quadrant order + labels + tones (plain labels, intent L6). */
export const QUADRANTS: ReadonlyArray<{
  id: QuadrantId;
  label: string;
  tone: MatrixTone;
  rowTone: ListItemTone | null;
}> = [
  { id: 'urgent-important', label: 'Urgent & Important', tone: 'danger', rowTone: 'danger' },
  { id: 'urgent-not-important', label: 'Urgent & Not Important', tone: 'amber', rowTone: 'amber' },
  { id: 'not-urgent-important', label: 'Not Urgent & Important', tone: 'accent', rowTone: 'accent' },
  {
    id: 'not-urgent-not-important',
    label: 'Not Urgent & Not Important',
    tone: 'green',
    rowTone: null,
  },
];

/**
 * Urgency is derived from `dueDate`, never stored. True iff `dueDate` lands on
 * an overdue day, today, or tomorrow; missing/empty/malformed is not urgent.
 *
 * Day-granular and timed-safe (lesson 0003): `dueDay` first normalizes a timed
 * instant to its local calendar day, so `dueDateState` classifies a timed value
 * correctly and the `Tomorrow` check compares the day — a `Tomorrow 09:00`
 * timed value is still urgent. No app-side ISO parsing.
 */
export function isUrgent(dueDate: string | null, today: string): boolean {
  const state = dueDateState(dueDate, today); // 'overdue' | 'today' | 'later' | 'none'
  if (state === 'overdue' || state === 'today') return true;
  const day = dueDay(dueDate);
  return day !== '' && dueDateLabel(day, today) === 'Tomorrow';
}

/** The quadrant a todo falls in: (`effectiveImportant`, `isUrgent`). */
export function quadrantOf(
  todo: Pick<Todo, 'effectiveImportant' | 'dueDate'>,
  today: string,
): QuadrantId {
  const urgent = isUrgent(todo.dueDate, today);
  const important = todo.effectiveImportant;
  if (urgent) return important ? 'urgent-important' : 'urgent-not-important';
  return important ? 'not-urgent-important' : 'not-urgent-not-important';
}

/**
 * The leading-checkbox tint for a todo's quadrant, from the single `QUADRANTS`
 * mapping (I `danger`, II `amber`, III `accent`, IV none). `rowToneOf` is the
 * one owner of quadrant → row tone; `/todos` and `/todos/matrix` both consume it.
 */
export function rowToneOf(
  todo: Pick<Todo, 'effectiveImportant' | 'dueDate'>,
  today: string,
): ListItemTone | undefined {
  const id = quadrantOf(todo, today);
  return QUADRANTS.find((quadrant) => quadrant.id === id)?.rowTone ?? undefined;
}

/** One quadrant's labelled bucket, in the fixed `QUADRANTS` order. */
export interface QuadrantBucket {
  id: QuadrantId;
  label: string;
  tone: MatrixTone;
  rowTone: ListItemTone | null;
  todos: Todo[];
}

/**
 * Group the given todos into the four quadrants, `QUADRANTS` order, in memory.
 *
 * Single owner of the open-only rule: the matrix is a planning view, so done todos are
 * skipped here (completed tasks live in the Done section on `/todos`) and the page just
 * calls this.
 */
export function groupByQuadrant(todos: readonly Todo[], today: string): QuadrantBucket[] {
  const buckets: Record<QuadrantId, Todo[]> = {
    'urgent-important': [],
    'urgent-not-important': [],
    'not-urgent-important': [],
    'not-urgent-not-important': [],
  };
  for (const todo of todos) {
    if (todo.done) continue;
    buckets[quadrantOf(todo, today)].push(todo);
  }
  return QUADRANTS.map(({ id, label, tone, rowTone }) => ({
    id,
    label,
    tone,
    rowTone,
    todos: buckets[id],
  }));
}
