import { readPref } from '@/lib/preferences';
import { listLists, listTodoTagUsage } from '@/lib/todo-api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { Pill, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { MatrixSwitch } from '../../settings/matrix-switch';
import { PushToggle } from '../../push-toggle';
import { submitFeedbackAction } from '../../feedback-actions';

export const dynamic = 'force-dynamic';

/**
 * A collection's settings row, the shape `/notes/settings` gives its Tags row: the names
 * dot-joined into the meta line, the count as the trailing pill. An empty collection keeps the
 * `0` pill and drops the meta line, exactly as the notes row does.
 */
function collectionRow(names: string[]) {
  return {
    description: names.length > 0 ? names.join(' · ') : undefined,
    control: <Pill>{names.length}</Pill>,
  };
}

/**
 * The shell draws the shared Appearance, Comfort, Support and closing line; this page adds the
 * two groups the todos app owns, in the order the screen reads them: the matrix opt-in, then the
 * reminder opt-in. The matrix row opens on the stored preference, read here at render.
 *
 * The destinations that used to ride the toolbar as icons live here as rows, in the order they
 * were: tags, lists, trash — the first two carrying their registry as the notes Tags row does.
 * Feedback is the shell's Support row, so it is not repeated.
 */
export default async function TodosSettingsPage() {
  const [matrixEnabled, tagUsage, lists] = await Promise.all([
    readPref('matrix'),
    listTodoTagUsage(),
    listLists(),
  ]);
  const namedTags = await resolveTagUsage(tagUsage);
  const tagNames = namedTags.map((tag) => tag.name);
  const listNames = lists.map((list) => list.name);

  return (
    <SettingsShell
      title="Settings"
      backHref="/todos"
      app="todos"
      onSubmit={submitFeedbackAction}
    >
      <SettingsBlock title="Todos">
        <SettingsRow
          label="Eisenhower matrix"
          description="Add a Matrix tab that groups todos into four quadrants."
          control={<MatrixSwitch checked={matrixEnabled} />}
        />
        <SettingsRow label="Tags" href="/todos/tags" {...collectionRow(tagNames)} />
        <SettingsRow label="Lists" href="/todos/lists" {...collectionRow(listNames)} />
        <SettingsRow label="Trash" href="/todos/trash" description="Todos you deleted." />
      </SettingsBlock>
      <SettingsBlock title="Reminders">
        <SettingsRow
          label="Push reminders"
          description="Get a notification when a todo is due."
          control={<PushToggle />}
        />
      </SettingsBlock>
    </SettingsShell>
  );
}
