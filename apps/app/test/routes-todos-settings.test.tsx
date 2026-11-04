import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsBlock, SettingsRow } from '@life/ui';
import { readPref } from '@/lib/preferences';

jest.mock('@/lib/preferences', () => ({
  readPref: jest.fn(),
  setPref: jest.fn(),
}));
jest.mock('@life/app-kit/preference-action', () => ({ setPref: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({ submitFeedbackAction: jest.fn() }));

import TodosSettingsPage from '@/app/todos/settings/page';

/** The page renders one `SettingsShell`; its `children` are the groups the page owns. */
function shellChildren(page: any): any[] {
  const kids = page?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

function todosBlock(page: any): any {
  return shellChildren(page).find(
    (child) => child?.type === SettingsBlock && child.props.title === 'Todos',
  );
}

function blockRows(block: any): any[] {
  const kids = block?.props?.children;
  if (kids == null) return [];
  return Array.isArray(kids) ? kids : [kids];
}

/**
 * The appearance control on `/todos/settings`. The page's shell wiring (including the matrix
 * switch) is pinned in `routes-settings.test.tsx`; this file pins what the shell's Appearance
 * group renders, since it is the screen the three-state swap changed, plus the settings rows the
 * toolbar icons became.
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
    expect(html).not.toContain('System, light, or dark.');
    expect(html).toContain('href="/todos"');
  });
});

describe('/todos/settings destination rows', () => {
  beforeEach(() => {
    (readPref as jest.MockedFunction<typeof readPref>).mockResolvedValue(true);
  });

  it('appends Tags, Lists and Trash as rows after the matrix row, in nav order', async () => {
    const page = await TodosSettingsPage();
    const rows = blockRows(todosBlock(page)).filter((row) => row.type === SettingsRow);

    expect(rows.map((row) => row.props.label)).toEqual([
      'Eisenhower matrix',
      'Tags',
      'Lists',
      'Trash',
    ]);
    expect(rows.slice(1).map((row) => row.props.href)).toEqual([
      '/todos/tags',
      '/todos/lists',
      '/todos/trash',
    ]);
    // The matrix row stays the preference control, not a destination.
    expect(rows[0].props.href).toBeUndefined();
  });

  it('renders each destination as a real link with the visible label as its name', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());

    for (const [label, href] of [
      ['Tags', '/todos/tags'],
      ['Lists', '/todos/lists'],
      ['Trash', '/todos/trash'],
    ]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`));
    }
  });

  it('keeps one feedback entry: the shell Support row, never a second in Todos', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());

    expect(html.match(/Tell us what got in the way\./g)).toHaveLength(1);
  });
});
