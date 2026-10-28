import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SettingsRowProps {
  /** Row label (left column). App-supplied copy. */
  label: ReactNode;
  /** Optional muted description under the label. */
  description?: ReactNode;
  /** The control rendered in the right column (e.g. `<ThemeToggle />`, `<Switch/>`). */
  control: ReactNode;
  /** Class passthrough. */
  className?: string;
}

/**
 * One setting: label on the left, the caller's control on the right. Below `sm`
 * the row becomes a labelled field — the control takes the full width under its
 * label instead of being clipped by the two-column line.
 */
const rowStyles = cx(
  'flex flex-wrap items-center justify-between',
  'gap-[var(--space-0-5)] max-sm:flex-col max-sm:items-stretch',
);

/** The label column takes the row's leftover width, so a long label never pushes the control out. */
const textStyles = 'flex flex-1 flex-col gap-[var(--space-0-15)] min-w-0';

/** A label may ellipsize only if its own box is allowed to shrink. */
const labelStyles = 'min-w-0';

const descriptionStyles = 'text-muted text-[length:var(--space-0-85)]';

/** The control keeps its intrinsic width and centres against the label line. */
const controlStyles = 'flex items-center shrink-0';

export function SettingsRow({ label, description, control, className }: Readonly<SettingsRowProps>) {
  return (
    <div className={cx('ui-settings-row', rowStyles, className)}>
      <div className={cx('ui-settings-row__text', textStyles)}>
        <span className={cx('ui-settings-row__label', labelStyles)}>{label}</span>
        {description != null && (
          <span className={cx('ui-settings-row__desc', descriptionStyles)}>{description}</span>
        )}
      </div>
      <div className={cx('ui-settings-row__control', controlStyles)}>{control}</div>
    </div>
  );
}
