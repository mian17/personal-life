import { settingsHref } from '@life/app-kit';
import { IconLink, SettingsLink } from '@life/ui';
import { ChartColumn } from 'lucide-react';

/**
 * The Pomodoro toolbar: the stats lens, then the bare settings control last. Feedback is the
 * Support row on `/pomodoro/settings`, exactly as the todos and meals toolbars keep only links.
 */
export function PomodoroNav() {
  return (
    <>
      <IconLink href="/pomodoro/stats" label="Stats" variant="bare">
        <ChartColumn size={20} aria-hidden />
      </IconLink>
      <SettingsLink href={settingsHref('/pomodoro')} />
    </>
  );
}
