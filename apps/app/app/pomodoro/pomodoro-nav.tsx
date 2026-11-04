import { settingsHref } from '@life/app-kit';
import { FeedbackNavItem, IconLink, SettingsLink } from '@life/ui';
import { ChartColumn } from 'lucide-react';
import { submitFeedbackAction } from '../feedback-actions';

/** The Pomodoro toolbar: stats, feedback, then the bare settings control last. */
export function PomodoroNav() {
  return (
    <>
      <IconLink href="/pomodoro/stats" label="Stats" variant="bare">
        <ChartColumn size={20} aria-hidden />
      </IconLink>
      <FeedbackNavItem app="pomodoro" onSubmit={submitFeedbackAction} />
      <SettingsLink href={settingsHref('/pomodoro')} />
    </>
  );
}
