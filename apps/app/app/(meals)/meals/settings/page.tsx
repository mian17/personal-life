import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';

/**
 * Meals settings — the shared settings idiom, mirroring `/notes/settings`: a
 * `ManagerBlock` (back to the app root) with the single Appearance block that
 * owns the theme preference. Meals has no app-specific settings yet, so this
 * page stays minimal.
 */
export default function MealsSettingsPage() {
  return (
    <ManagerBlock title="Settings" backHref="/meals">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle inGroup />} />
      </SettingsBlock>
    </ManagerBlock>
  );
}
