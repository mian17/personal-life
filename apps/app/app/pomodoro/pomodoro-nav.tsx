import { settingsHref } from '@life/app-kit';
import { FeedbackNavItem, IconLink } from '@life/ui';
import { ChartColumn, Settings } from 'lucide-react';
import { submitFeedbackAction } from '../feedback-actions';

/** The Pomodoro toolbar: stats first, then feedback, the gear last. */
export function PomodoroNav() {
  return (
    <>
      <IconLink href="/pomodoro/stats" label="Stats">
        <ChartColumn size={20} aria-hidden />
      </IconLink>
      <FeedbackNavItem app="pomodoro" onSubmit={submitFeedbackAction} />
      <IconLink href={settingsHref('/pomodoro')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  );
}
