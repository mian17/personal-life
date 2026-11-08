import { SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '../../feedback-actions';

/**
 * Feedback settings renders the shared settings shape: the `SettingsShell` owns the Appearance,
 * Comfort, Support groups and the closing prototype line. The inbox has no app-specific settings,
 * so the shell's `children` slot stays empty.
 */
export default function FeedbackSettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      backHref="/feedback"
      app="feedback"
      onSubmit={submitFeedbackAction}
    />
  );
}
