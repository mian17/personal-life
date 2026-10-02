import type { TodoRepeat } from '@life/shared';
import { dueDay, formatDayMonth, formatWeekday } from '@life/ui';

/**
 * The one owner of the repeat → human-label mapping (lesson 0016): the row meta
 * and the editor's repeat options both read it. App-owned because `@life/ui`
 * has no `@life/shared` dependency, so the `TodoRepeat` vocabulary cannot live
 * upstream. The parenthetical is derived from the todo's due date through the
 * shared `@life/ui` formatters (`dueDay`, `formatWeekday`, `formatDayMonth`) —
 * never a locale API — and a missing/malformed due falls back to the bare base
 * label rather than an empty `Weekly ()`.
 */
const BASE_LABELS: Record<TodoRepeat, string> = {
  daily: 'Daily',
  weekdays: 'Every Weekday (Mon - Fri)',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** The ordinal suffix for a day of the month (`1st`, `2nd`, `11th`, `21st`). */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function repeatLabel(repeat: TodoRepeat | null, dueDate?: string | null): string | null {
  if (repeat == null) return null;
  const base = BASE_LABELS[repeat];
  if (repeat === 'daily' || repeat === 'weekdays') return base;

  const day = dueDay(dueDate);
  if (day === '') return base;

  if (repeat === 'weekly') {
    const weekday = formatWeekday(day);
    return weekday === '' ? base : `${base} (${weekday})`;
  }
  if (repeat === 'monthly') {
    const dayNumber = Number(day.split('-')[2]);
    return `${base} (The ${ordinal(dayNumber)} day)`;
  }
  const dayMonth = formatDayMonth(day);
  return dayMonth === '' ? base : `${base} (${dayMonth})`;
}
