import { Pill, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '../../../feedback-actions';

/**
 * Meals settings renders the shared settings shape — `SettingsShell` owns the Appearance,
 * Comfort and Support groups plus the closing prototype line — and adds the one group the app
 * owns: the destinations that used to ride the day view's toolbar as icons. The target row is
 * the same route as the toolbar's Daily target control, which is the app's one target screen.
 * Feedback is the shell's Support row, so it is not repeated here.
 */
export default function MealsSettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      backHref="/meals"
      app="meals"
      onSubmit={submitFeedbackAction}
    >
      <SettingsBlock title="Meals">
        <SettingsRow label="Daily target" href="/meals/target" control={<Pill>Edit</Pill>} />
        <SettingsRow label="Saved meals" href="/meals/saved" />
        <SettingsRow label="Foods" href="/meals/foods" />
      </SettingsBlock>
    </SettingsShell>
  );
}
