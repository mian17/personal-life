import { readPref } from '@/lib/preferences';
import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { MatrixSwitch } from '../../settings/matrix-switch';
import { PushToggle } from '../../push-toggle';

export const dynamic = 'force-dynamic';

export default async function TodosSettingsPage() {
  const matrixEnabled = await readPref('matrix');
  return (
    <ManagerBlock title="Settings" backHref="/todos">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle />} />
      </SettingsBlock>
      <SettingsBlock title="Todos">
        <SettingsRow
          label="Eisenhower matrix"
          description="Add a Matrix tab that groups todos into four quadrants."
          control={<MatrixSwitch checked={matrixEnabled} />}
        />
      </SettingsBlock>
      <SettingsBlock title="Reminders">
        <SettingsRow
          label="Push reminders"
          description="Get a notification when a todo is due."
          control={<PushToggle />}
        />
      </SettingsBlock>
    </ManagerBlock>
  );
}
