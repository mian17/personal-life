import { settingsHref } from '@life/app-kit';
import { IconLink } from '@life/ui';
import { List, Settings, Tags, Trash2 } from 'lucide-react';

/** The Todos toolbar nav icons, shared by `/todos` and its lenses. */
export function TodosNav() {
  return (
    <>
      <IconLink href="/todos/tags" label="Manage tags">
        <Tags size={20} aria-hidden />
      </IconLink>
      <IconLink href="/todos/lists" label="Manage lists">
        <List size={20} aria-hidden />
      </IconLink>
      <IconLink href="/todos/trash" label="Trash">
        <Trash2 size={20} aria-hidden />
      </IconLink>
      <IconLink href={settingsHref('/todos')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  );
}
