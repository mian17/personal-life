import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

import MealsSettingsPage from '@/app/(meals)/meals/settings/page';

/** React children normalized to an array (single child or list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return Array.isArray(kids) ? kids : [kids];
}

function settingsBlock(page: any, title: string): any {
  return childList(page).find(
    (child) => child?.type === SettingsBlock && child.props.title === title,
  );
}

function settingsRow(block: any, label: string): any {
  return childList(block).find(
    (child) => child?.type === SettingsRow && child.props.label === label,
  );
}

describe('/meals/settings page wiring', () => {
  it('composes ManagerBlock titled Settings backed to /meals with Appearance only', () => {
    const page = MealsSettingsPage();

    expect(page.type).toBe(ManagerBlock);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/meals');

    const blocks = childList(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe(SettingsBlock);
    expect(blocks[0].props.title).toBe('Appearance');
  });

  it('renders the Theme row with a ThemeToggle control', () => {
    const page = MealsSettingsPage();
    const row = settingsRow(settingsBlock(page, 'Appearance'), 'Theme');

    expect(row).toBeDefined();
    expect(row.props.control.type).toBe(ThemeToggle);
  });

  it('renders the frozen copy and a back affordance targeting /meals', () => {
    const html = renderToStaticMarkup(MealsSettingsPage());

    expect(html).toContain('Settings');
    expect(html).toContain('Theme');
    expect(html).toContain('System, light, or dark.');
    expect(html).toContain('href="/meals"');
  });
});
