import { renderToStaticMarkup } from 'react-dom/server';
import { readPref } from '@/lib/preferences';

jest.mock('@/lib/preferences', () => ({
  readPref: jest.fn(),
  setPref: jest.fn(),
}));
jest.mock('@life/app-kit/preference-action', () => ({ setPref: jest.fn() }));

import TodosSettingsPage from '@/app/todos/settings/page';

/**
 * The appearance control on `/todos/settings`. The page's block wiring (including
 * the matrix switch) is pinned in `routes-settings.test.tsx`; this file pins what
 * the Theme row's control renders, since it is the screen the three-state swap
 * changed.
 */
describe('/todos/settings appearance control', () => {
  beforeEach(() => {
    (readPref as jest.MockedFunction<typeof readPref>).mockResolvedValue(true);
  });

  it('renders the three-state Light/Dark/System control as one pressed group', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Appearance"');
    for (const label of ['Light', 'Dark', 'System']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('lays the appearance segment into the settings row: full width, no trough chrome', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());
    const segment = html.match(/role="group" aria-label="Appearance"[^>]*/)?.[0] ?? '';

    expect(segment).toContain('w-full');
    expect(segment).not.toContain('bg-surface-sunken');
  });

  it('leaves the todos matrix switch untouched beside it', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());

    expect(html).toContain('aria-label="Eisenhower matrix"');
    expect(html).toContain('System, light, or dark.');
    expect(html).toContain('href="/todos"');
  });
});
