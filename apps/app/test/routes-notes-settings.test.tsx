import { renderToStaticMarkup } from 'react-dom/server';

import NotesSettingsPage from '@/app/notes/settings/page';

/**
 * The appearance control on `/notes/settings`. The page's block wiring (the
 * `ManagerBlock`/`SettingsBlock`/`SettingsRow` composition and the Theme row's
 * control type) is pinned in `routes-settings.test.tsx`; this file pins what the
 * control itself renders, since it is the screen the three-state swap changed.
 */
describe('/notes/settings appearance control', () => {
  it('renders the three-state Light/Dark/System control as one pressed group', () => {
    const html = renderToStaticMarkup(NotesSettingsPage());

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Appearance"');
    for (const label of ['Light', 'Dark', 'System']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('lays the appearance segment into the settings row: full width, no trough chrome', () => {
    const html = renderToStaticMarkup(NotesSettingsPage());
    const segment = html.match(/role="group" aria-label="Appearance"[^>]*/)?.[0] ?? '';

    expect(segment).toContain('w-full');
    expect(segment).not.toContain('bg-surface-sunken');
  });

  it('keeps the row label and description the settings idiom already reads', () => {
    const html = renderToStaticMarkup(NotesSettingsPage());

    expect(html).toContain('Theme');
    expect(html).toContain('System, light, or dark.');
    expect(html).toContain('href="/notes"');
  });
});
