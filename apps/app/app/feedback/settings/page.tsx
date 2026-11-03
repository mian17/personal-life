import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';

export default function FeedbackSettingsPage() {
  return (
    <ManagerBlock title="Settings" backHref="/feedback">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle inGroup />} />
      </SettingsBlock>
    </ManagerBlock>
  );
}
