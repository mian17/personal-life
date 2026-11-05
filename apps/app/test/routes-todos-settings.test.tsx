import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsBlock, SettingsRow } from '@life/ui';
import { readPref } from '@/lib/preferences';

jest.mock('@/lib/preferences', () => ({
  readPref: jest.fn(),
  setPref: jest.fn(),
}));
jest.mock('@life/app-kit/preference-action', () => ({ setPref: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({ submitFeedbackAction: jest.fn() }));

// The counted rows read the tag and list registries through the server-only barrels;
// mocking them keeps `next/headers`/fetch out of the node test env.
jest.mock('@/lib/todo-api', () => ({
  listTodoTagUsage: jest.fn(),
  listLists: jest.fn(),
}));
jest.mock('@/lib/tags-compose', () => ({ resolveTagUsage: jest.fn() }));

import { listLists, listTodoTagUsage } from '@/lib/todo-api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { Pill } from '@life/ui';
import TodosSettingsPage from '@/app/todos/settings/page';

const mockedListTodoTagUsage = listTodoTagUsage as jest.MockedFunction<typeof listTodoTagUsage>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedResolveTagUsage = resolveTagUsage as jest.MockedFunction<typeof resolveTagUsage>;

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

function todosRow(page: any, label: string): any {
  return blockRows(todosBlock(page)).find(
    (row) => row?.type === SettingsRow && row.props.label === label,
  );
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
    mockedListTodoTagUsage.mockResolvedValue([]);
    mockedListLists.mockResolvedValue([]);
    mockedResolveTagUsage.mockResolvedValue([]);
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
    mockedListTodoTagUsage.mockResolvedValue([]);
    mockedListLists.mockResolvedValue([]);
    mockedResolveTagUsage.mockResolvedValue([]);
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

/**
 * The row anatomy `/notes/settings` sets: a collection row carries its names dot-joined into the
 * meta line and its count in the trailing pill; a destination with nothing to count carries the
 * honest prose line and no pill. `SettingsRow` draws the chevron itself for every `href`.
 */
describe('/todos/settings row anatomy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (readPref as jest.MockedFunction<typeof readPref>).mockResolvedValue(true);
    mockedListTodoTagUsage.mockResolvedValue([
      { tagId: 1, count: 3 },
      { tagId: 2, count: 1 },
    ]);
    mockedResolveTagUsage.mockResolvedValue([
      { tagId: 1, count: 3, name: 'home' },
      { tagId: 2, count: 1, name: 'work' },
    ]);
    mockedListLists.mockResolvedValue([
      { id: 'l1', name: 'Work', importantDefault: null, version: 1, createdAt: '2026-01-01' },
      { id: 'l2', name: 'Home', importantDefault: null, version: 1, createdAt: '2026-01-01' },
    ]);
  });

  it('mirrors the notes Tags row: names in the meta line, count in the pill', async () => {
    const page = await TodosSettingsPage();
    const tags = todosRow(page, 'Tags');

    expect(tags.props.href).toBe('/todos/tags');
    expect(tags.props.description).toBe('home · work');
    expect(tags.props.control.type).toBe(Pill);
    expect(tags.props.control.props.children).toBe(2);
    expect(mockedResolveTagUsage).toHaveBeenCalledWith(await mockedListTodoTagUsage.mock.results[0].value);
  });

  it('gives Lists the same anatomy, counted from the list registry', async () => {
    const page = await TodosSettingsPage();
    const lists = todosRow(page, 'Lists');

    expect(lists.props.href).toBe('/todos/lists');
    expect(lists.props.description).toBe('Work · Home');
    expect(lists.props.control.type).toBe(Pill);
    expect(lists.props.control.props.children).toBe(2);
  });

  it('gives Trash the notes Trash row: the prose meta line and no count pill', async () => {
    const trash = todosRow(await TodosSettingsPage(), 'Trash');

    expect(trash.props.href).toBe('/todos/trash');
    expect(trash.props.description).toBe('Todos you deleted.');
    expect(trash.props.control).toBeUndefined();
  });

  it('drops the meta line but keeps the 0 pill for an empty collection', async () => {
    mockedListTodoTagUsage.mockResolvedValue([]);
    mockedResolveTagUsage.mockResolvedValue([]);
    mockedListLists.mockResolvedValue([]);

    const page = await TodosSettingsPage();

    expect(todosRow(page, 'Tags').props.description).toBeUndefined();
    expect(todosRow(page, 'Tags').props.control.props.children).toBe(0);
    expect(todosRow(page, 'Lists').props.description).toBeUndefined();
    expect(todosRow(page, 'Lists').props.control.props.children).toBe(0);
  });

  it('renders each destination row with the chevron SettingsRow draws for an href', async () => {
    const html = renderToStaticMarkup(await TodosSettingsPage());

    expect(html).toContain('home · work');
    expect(html).toContain('Todos you deleted.');
    expect(html.match(/>2<\/span>/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/lucide-chevron-right/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
