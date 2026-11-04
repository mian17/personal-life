import { settingsHref } from '@life/app-kit';
import { SettingsLink } from '@life/ui';

/**
 * The Todos toolbar, shared by `/todos` and its lenses. Settings is its only control: the tags,
 * lists and trash destinations moved to `/todos/settings` rows, and feedback is that screen's
 * Support row.
 */
export function TodosNav() {
  return <SettingsLink href={settingsHref('/todos')} />;
}
