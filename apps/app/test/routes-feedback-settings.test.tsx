import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

import FeedbackSettingsPage from '@/app/feedback/settings/page';

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

describe('/feedback/settings page wiring', () => {
  it('composes ManagerBlock titled Settings backed to /feedback with Appearance only', () => {
    const page = FeedbackSettingsPage();

    expect(page.type).toBe(ManagerBlock);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/feedback');

    const blocks = childList(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe(SettingsBlock);
    expect(blocks[0].props.title).toBe('Appearance');
  });

  it('renders the Theme row with a ThemeToggle control', () => {
    const page = FeedbackSettingsPage();
    const row = settingsRow(settingsBlock(page, 'Appearance'), 'Theme');

    expect(row).toBeDefined();
    expect(row.props.control.type).toBe(ThemeToggle);
  });

  it('renders the three-state Light/Dark/System appearance control', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Appearance"');
    for (const label of ['Light', 'Dark', 'System']) {
      expect(html).toContain(`>${label}</button>`);
    }
    // Server render is the System choice, and the mount read moves it once stored.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('renders the frozen copy and a back affordance targeting /feedback', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());

    expect(html).toContain('Settings');
    expect(html).toContain('Theme');
    expect(html).toContain('System, light, or dark.');
    expect(html).toContain('href="/feedback"');
  });
});
