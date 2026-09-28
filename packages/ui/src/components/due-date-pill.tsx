import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type DueDateState = 'overdue' | 'today' | 'later' | 'none';

/** Local calendar date as `YYYY-MM-DD` (the ISO shape the todo API uses). */
export function todayIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Grouping semantics for `/todos`: a due date before `today` is overdue, the
 * same day is today, anything after is later; no date is its own group.
 * ISO `YYYY-MM-DD` strings compare correctly as plain strings.
 */
export function dueDateState(dueDate: string | null | undefined, today: string): DueDateState {
  if (dueDate == null || dueDate === '') return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'later';
}

export interface DueDatePillProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  dueDate: string | null;
  /** Injected "today" (`YYYY-MM-DD`) so the state is deterministic in tests/SSR. */
  today?: string;
  emptyLabel?: string;
}

export function DueDatePill({
  dueDate,
  today,
  emptyLabel = 'No date',
  className,
  ...rest
}: DueDatePillProps) {
  const state = dueDateState(dueDate, today ?? todayIso());
  const dated = state !== 'none';

  return (
    <span
      className={cx('ui-due-pill', `ui-due-pill--${state}`, className)}
      data-state={state}
      {...rest}
    >
      {dated ? <time dateTime={dueDate ?? undefined}>{dueDate}</time> : emptyLabel}
    </span>
  );
}
