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

/** §8's status pill, worn by the read-out: a 24px tint carrying the word. */
const pillStyles =
  'ui-due-pill inline-flex items-center h-[var(--s6)] px-[var(--s2)] rounded-[var(--r-pill)] text-[length:var(--fs-pill)] font-semibold tracking-[var(--tracking-pill)] whitespace-nowrap';

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
        pillStyles,
        stateColours(state),
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
 * State → the tint pair: overdue is the danger word on its tint, today the warn word on its
 * tint, an absent or later date the neutral pill.
 */
function stateColours(state: DueDateState): string {
  if (state === 'overdue') return 'bg-danger-soft text-danger';
  if (state === 'today') return 'bg-warn-soft text-warn';
  return 'bg-surface-sunken text-ink-2';
}
