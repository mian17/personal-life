import { navActions } from '@life/app-kit';
import { IconLink } from '@life/ui';
import { ChartColumn, ListOrdered } from 'lucide-react';

/**
 * The Meditation toolbar: the stats lens, then the sitting log, then the bare settings control
 * last. Feedback is the Support row on `/meditation/settings`, exactly as the pomodoro, todos
 * and meals toolbars keep only links.
 */
export function MeditationNav() {
  return navActions(
    'meditation',
    <>
      <IconLink href="/meditation/stats" label="Stats" variant="bare">
        <ChartColumn size={20} aria-hidden />
      </IconLink>
      <IconLink href="/meditation/sessions" label="Sessions" variant="bare">
        <ListOrdered size={20} aria-hidden />
      </IconLink>
    </>,
  );
}
