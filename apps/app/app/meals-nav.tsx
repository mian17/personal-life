import { settingsHref } from '@life/app-kit';
import { IconLink } from '@life/ui';
import { Bookmark, Settings, Target } from 'lucide-react';

/**
 * The Meals toolbar nav icons, shared by the list and day routes. The target
 * route is a full-screen editor that renders its own chrome, so it has no nav.
 */
export function MealsNav() {
  return (
    <>
      <IconLink href="/meals/target" label="Daily target">
        <Target size={20} aria-hidden />
      </IconLink>
      <IconLink href="/meals/saved" label="Saved meals">
        <Bookmark size={20} aria-hidden />
      </IconLink>
      <IconLink href={settingsHref('/meals')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  );
}
