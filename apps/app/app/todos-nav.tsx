import { settingsHref } from '@life/app-kit';
import { FeedbackNavItem, IconLink, SettingsLink } from '@life/ui';
import { List, Tags, Trash2 } from 'lucide-react';
import { submitFeedbackAction } from './feedback-actions';

/** The Todos toolbar nav icons, shared by `/todos` and its lenses. */
export function TodosNav() {
  return (
    <>
      <IconLink href="/todos/tags" label="Manage tags" variant="bare">
        <Tags size={20} aria-hidden />
      </IconLink>
      <IconLink href="/todos/lists" label="Manage lists" variant="bare">
        <List size={20} aria-hidden />
      </IconLink>
      <IconLink href="/todos/trash" label="Trash" variant="bare">
        <Trash2 size={20} aria-hidden />
      </IconLink>
      <FeedbackNavItem app="todos" onSubmit={submitFeedbackAction} />
      <SettingsLink href={settingsHref('/todos')} />
    </>
  );
}
