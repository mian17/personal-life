import { readPref } from '@/lib/preferences';
import { SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { MatrixSwitch } from '../../settings/matrix-switch';
import { PushToggle } from '../../push-toggle';
import { submitFeedbackAction } from '../../feedback-actions';

export const dynamic = 'force-dynamic';

/**
 * The shell draws the shared Appearance, Comfort, Support and closing line; this page adds the
 * two groups the todos app owns, in the order the screen reads them: the matrix opt-in, then the
 * reminder opt-in. The matrix row opens on the stored preference, read here at render.
 *
 * The destinations that used to ride the toolbar as icons live here as rows, in the order they
 * were: tags, lists, trash. Feedback is the shell's Support row, so it is not repeated.
 */
export default async function TodosSettingsPage() {
  const matrixEnabled = await readPref('matrix');

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
        <SettingsRow label="Tags" href="/todos/tags" />
        <SettingsRow label="Lists" href="/todos/lists" />
        <SettingsRow label="Trash" href="/todos/trash" />
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
