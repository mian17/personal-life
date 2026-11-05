import { settingsHref } from '@life/app-kit';
import { IconLink, SettingsLink } from '@life/ui';
import { Target } from 'lucide-react';

/**
 * The Meals toolbar: the day's target and the settings gear, nothing else. The saved-meals and
 * foods destinations moved to rows on `/meals/settings`, and feedback is that screen's Support
 * row, exactly as the todos toolbar keeps only its gear. The target route is a full-screen editor
 * that renders its own chrome, so it has no nav.
 */
export function MealsNav() {
  return (
    <>
      <IconLink href="/meals/target" label="Daily target" variant="bare">
        <Target size={20} aria-hidden />
      </IconLink>
      <SettingsLink href={settingsHref('/meals')} />
    </>
  );
}
