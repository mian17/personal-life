import type { ComponentPropsWithRef } from 'react';
import { dueDay, todayIso } from '../lib/date-parts';
import { cx } from '../lib/cx';

export { todayIso } from '../lib/date-parts';

export type DueDateState = 'overdue' | 'today' | 'later' | 'none';

/**
 * Grouping semantics for `/todos`: a due day before `today` is overdue, the
 * same day is today, anything after is later; no date is its own group.
 * Comparison is day-granular via `dueDay`, so a timed todo due earlier today is
 * `today`, not `overdue`. A missing or malformed value is `none` — it must
 * never fall into `overdue`.
 */
export function dueDateState(dueDate: string | null | undefined, today: string): DueDateState {
  const day = dueDay(dueDate);
  if (day === '') return 'none';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
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
}: Readonly<DueDatePillProps>) {
  const state = dueDateState(dueDate, today ?? todayIso());
  const dated = state !== 'none';

  return (
    <span
      className={cx(
        'ui-due-pill text-[length:var(--space-0-85)]',
        stateColour(state),
        `ui-due-pill--${state}`,
        className,
      )}
      data-state={state}
      {...rest}
    >
      {dated ? <time dateTime={dueDate ?? undefined}>{dueDate}</time> : emptyLabel}
    </span>
  );
}

/**
 * State → text colour: overdue is the only state that earns the danger colour,
 * today is accented, and an absent or later date stays muted.
 */
function stateColour(state: DueDateState): string {
  if (state === 'overdue') return 'text-danger';
  if (state === 'today') return 'text-accent';
  return 'text-muted';
}
