import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';

export default function NotesSettingsPage() {
  return (
    <ManagerBlock title="Settings" backHref="/notes">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle inGroup />} />
      </SettingsBlock>
    </ManagerBlock>
  );
}
