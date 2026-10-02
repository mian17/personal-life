import type { TodoRepeat } from '@life/shared';

/**
 * The one owner of the repeat → human-label mapping (lesson 0016): the row meta
 * and the editor's repeat options both read it. App-owned because `@life/ui`
 * has no `@life/shared` dependency, so the `TodoRepeat` vocabulary cannot live
 * upstream.
 */
const REPEAT_LABELS: Record<TodoRepeat, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function repeatLabel(repeat: TodoRepeat | null): string | null {
  return repeat == null ? null : REPEAT_LABELS[repeat];
}
