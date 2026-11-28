import { AlertBanner, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '@/app/feedback-actions';
import { fetchSettings, type SettingsRow as StoredSettings } from '@/lib/meditation-api';
import { DailyGoalForm, SAVE_FAILED_FLAG } from './daily-goal-form';

export const dynamic = 'force-dynamic';

/**
 * `/meditation/settings` — the shell draws Appearance, Comfort and Support; the page adds the two
 * groups it owns: the daily goal, and the sitting log's entry point.
 *
 * The log is a row rather than a toolbar icon, and it sits outside the goal's branch: it opens a
 * page, so an unreachable service must not take it away with the form.
 *
 * The stored sitting length and the bells have no editor here: the idle screen's stepper picks the
 * length of the sitting being started, and `/meditation`'s bells sheet owns the bells. Both are
 * read back with the goal on every save, so neither is ever reset from this screen.
 */
export default async function MeditationSettingsRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const settings = await readSettings();
  const saveFailed = (await searchParams).error === SAVE_FAILED_FLAG;

  return (
    <SettingsShell
      title="Settings"
      backHref="/meditation"
      app="meditation"
      onSubmit={submitFeedbackAction}
    >
      {settings === null ? (
        <UnavailableSettings />
      ) : (
        <DailyGoalForm goalMinutes={settings.goalMinutes} saveFailed={saveFailed} />
      )}
      <SettingsBlock title="Sitting log">
        <SettingsRow
          label="Sitting log"
          href="/meditation/sessions"
          description="Every sitting you have kept, newest first."
        />
      </SettingsBlock>
    </SettingsShell>
  );
}

/** No stored row to open on, so the screen says what is missing instead of inventing a goal. */
function UnavailableSettings() {
  return (
    <AlertBanner>
      Settings are unavailable — meditation-service did not answer. Reload to try again.
    </AlertBanner>
  );
}

/** The owner's configuration, or `null`: an unreachable service has nothing for a form to open on. */
async function readSettings(): Promise<StoredSettings | null> {
  try {
    return await fetchSettings();
  } catch {
    return null;
  }
}
