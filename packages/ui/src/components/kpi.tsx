import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface KpiProps {
  /** The headline number, already formatted by the caller (`820`, `1,180`). */
  value: ReactNode;
  /** The unit beside it (`kcal`, `of 2,050 kcal`). */
  unit: ReactNode;
  /**
   * The quiet line above the read-out — §8's `.row__meta` tier (`"Logged so far"`,
   * `"Derived energy"`). Absent, the atom renders the bare row it always did.
   */
  label?: ReactNode;
  /** Class passthrough. */
  className?: string;
}

/** §8's `.kpi__row`: the number and its unit share a baseline. */
const rowStyles = 'flex items-baseline gap-[var(--s2)]';

/** §8's `.kpi`: the `--fs-kpi` step, tight leading and tracking, tabular figures. */
const valueStyles =
  'text-[length:var(--fs-kpi)] leading-[var(--lh-kpi)] font-bold tracking-[var(--tracking-kpi)] tabular-nums';

/** §8's `.kpi__unit`: chip size, semibold, the second ink tier, no extra tracking. */
const unitStyles =
  'text-[length:var(--fs-chip)] font-semibold text-ink-2 tracking-[var(--tracking-none)]';

/** §8's `.row__meta`: the meta tier, second ink tier — the line that names the read-out. */
const labelStyles = 'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

/** §8's `.kpi__row` margin-top: one step of air under the label. */
const labelledStyles = 'grid gap-[var(--s1)]';

/**
 * One KPI read-out. Presentation only: the caller formats the number and names the
 * unit, so the atom never decides thresholds or tone. No outer margin is drawn —
 * the rhythm above it belongs to the parent.
 */
export function Kpi({ value, unit, label, className }: Readonly<KpiProps>) {
  const row = (
    <div className={cx('ui-kpi', rowStyles, label == null && className)}>
      <span className={cx('ui-kpi__value', valueStyles)}>{value}</span>
      <span className={cx('ui-kpi__unit', unitStyles)}>{unit}</span>
    </div>
  );

  if (label == null) return row;

  return (
    <div className={cx('ui-kpi-block', labelledStyles, className)}>
      <div className={cx('ui-kpi__label', labelStyles)}>{label}</div>
      {row}
    </div>
  );
}
