import { dueDateState, todayIso, type DueDateState } from './due-date-pill';
import { dueDateLabel } from '../lib/format-date';
import { cx } from '../lib/cx';

export type DueDateTone = 'plain' | 'signal';

export interface DueDateProps {
  dueDate: string | null;
  /** Injected "today" (`YYYY-MM-DD`) for deterministic SSR/tests. */
  today?: string;
  /** `plain` = muted (default); `signal` = overdue deep red, future lighter red. */
  tone?: DueDateTone;
  className?: string;
}

/**
 * Presentational due-date read-out. Renders the shared dd/mm/yyyy / Today /
 * Tomorrow label (lesson 0003: one owner for frontend date reads) and colours the
 * grouping state through the token utilities.
 */
export function DueDate({ dueDate, today, tone = 'plain', className }: Readonly<DueDateProps>) {
  const state = dueDateState(dueDate, today ?? todayIso());

  return (
    <span
      className={cx(
        'ui-due-date',
        toneColour(tone, state),
        `ui-due-date--${state}`,
        tone === 'signal' && 'ui-due-date--signal',
        className,
      )}
    >
      {dueDateLabel(dueDate, today)}
    </span>
  );
}

/**
 * Signal tone → colour: overdue earns the deep danger red, any other dated read-out
 * the lighter red. `plain` is muted, and so is an undated read-out either way.
 */
function toneColour(tone: DueDateTone, state: DueDateState): string {
  if (tone === 'plain') return 'text-muted';
  if (state === 'none') return 'text-muted';
  if (state === 'overdue') return 'text-danger';
  return 'text-danger-soft';
}
