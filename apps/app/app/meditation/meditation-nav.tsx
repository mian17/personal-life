import { navActions } from '@life/app-kit';
import { IconLink } from '@life/ui';
import { ChartColumn } from 'lucide-react';

/**
 * The Meditation toolbar: the stats lens, then the bare settings control last. The sitting log is
 * a row on `/meditation/settings`, not an icon here. Feedback is the Support row on that same
 * screen, exactly as the pomodoro, todos and meals toolbars keep only links.
 */
export function MeditationNav() {
  return navActions(
    'meditation',
    <>
      <IconLink href="/meditation/stats" label="Stats" variant="bare">
        <ChartColumn size={20} aria-hidden />
      </IconLink>
    </>,
  );
}
