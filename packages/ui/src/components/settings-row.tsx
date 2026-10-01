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

export function SettingsRow({ label, description, control, className }: SettingsRowProps) {
  return (
    <div className={cx('ui-settings-row', className)}>
      <div className="ui-settings-row__text">
        <span className="ui-settings-row__label">{label}</span>
        {description != null && (
          <span className="ui-settings-row__desc">{description}</span>
        )}
      </div>
      <div className="ui-settings-row__control">{control}</div>
    </div>
  );
}
