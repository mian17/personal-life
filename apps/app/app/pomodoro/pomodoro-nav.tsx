import { settingsHref } from '@life/app-kit';
import { FeedbackNavItem, IconLink } from '@life/ui';
import { Settings } from 'lucide-react';
import { submitFeedbackAction } from '../feedback-actions';

/** The Pomodoro toolbar, in the `/todos` order: feedback first, the gear last. */
export function PomodoroNav() {
  return (
    <>
      <FeedbackNavItem app="pomodoro" onSubmit={submitFeedbackAction} />
      <IconLink href={settingsHref('/pomodoro')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  );
}
