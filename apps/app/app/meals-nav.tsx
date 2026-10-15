import { settingsHref } from '@life/app-kit';
import { FeedbackNavItem, IconLink } from '@life/ui';
import { Bookmark, Settings, Target } from 'lucide-react';
import { submitFeedbackAction } from './feedback-actions';

/**
 * The Meals toolbar nav icons, rendered by the day route. The target route is a
 * full-screen editor that renders its own chrome, so it has no nav.
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
      <FeedbackNavItem app="meals" onSubmit={submitFeedbackAction} />
      <IconLink href={settingsHref('/meals')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  );
}
