import { SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '../../../feedback-actions';

/**
 * Meals settings renders the shared settings shape: the `SettingsShell` owns the Appearance,
 * Comfort, Support groups and the closing prototype line. Meals has no app-specific settings
 * yet, so the shell's `children` slot stays empty.
 */
export default function MealsSettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      backHref="/meals"
      app="meals"
      onSubmit={submitFeedbackAction}
    />
  );
}
