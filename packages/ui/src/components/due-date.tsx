import { dueDateState, todayIso } from './due-date-pill';
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
 * Tomorrow label (lesson 0003: one owner for frontend date reads) and exposes
 * the grouping state as a class so CSS can colour it.
 */
export function DueDate({ dueDate, today, tone = 'plain', className }: DueDateProps) {
  const state = dueDateState(dueDate, today ?? todayIso());

  return (
    <span
      className={cx(
        'ui-due-date',
        `ui-due-date--${state}`,
        tone === 'signal' && 'ui-due-date--signal',
        className,
      )}
    >
      {dueDateLabel(dueDate, today)}
    </span>
  );
}
