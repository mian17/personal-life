import type { List, TagUsage, Todo } from '@life/shared';
import { PreservingSearchBox } from '@life/app-kit';
import { IconLink, ListShell, Pill, PillGroup, Tab, TabBar, TagFilterNav, ThemeToggle } from '@life/ui';

jest.mock('@/lib/todo-api', () => ({
  listTodos: jest.fn(),
  listTodoTagUsage: jest.fn(),
  listLists: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  listTags: jest.fn(),
  resolveTags: jest.fn(),
}));
// The barrel re-exports the server-only `readPref` (next/headers); mock it so the
// server module never loads under jest.
jest.mock('@/lib/preferences', () => ({ readPref: jest.fn() }));

import { listTodos, listTodoTagUsage, listLists } from '@/lib/todo-api';
import { listTags, resolveTags } from '@/lib/tags-api';
import { readPref } from '@/lib/preferences';
import TodosPage from '@/app/todos/page';

const mockedListTodos = listTodos as jest.MockedFunction<typeof listTodos>;
const mockedUsage = listTodoTagUsage as jest.MockedFunction<typeof listTodoTagUsage>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListTags = listTags as jest.MockedFunction<typeof listTags>;
const mockedResolveTags = resolveTags as jest.MockedFunction<typeof resolveTags>;
const mockedReadPref = readPref as jest.MockedFunction<typeof readPref>;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: null,
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: null,
    listId: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

function find(node: any, type: unknown, label?: string): any {
  return asArray(node.props ? node : { props: { children: node } }).find(
    (child) =>
      child != null &&
      child.type === type &&
      (label === undefined || child.props.label === label),
  );
}

describe('/todos list page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTodos.mockResolvedValue({
      todos: [todo({ id: 't1', title: 'Buy milk', listId: 'l1', tagIds: [1] })],
      nextCursor: null,
    });
    mockedUsage.mockResolvedValue([{ tagId: 1, count: 2 }] as TagUsage[]);
    mockedListLists.mockResolvedValue([
      {
        id: 'l1',
        name: 'Groceries',
        importantDefault: null,
        version: 0,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ] as List[]);
    mockedListTags.mockResolvedValue([
      { id: 1, name: 'errand', version: 0, createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    mockedResolveTags.mockResolvedValue([{ id: 1, name: 'errand' }]);
    mockedReadPref.mockResolvedValue(false);
  });

  it('renders ListShell titled Todos with the frozen fab label', async () => {
    const el = await TodosPage({
      searchParams: Promise.resolve({ q: 'milk', list: 'l1', tag: '1', done: 'false' }),
    });

    expect(el.type).toBe(ListShell);
    expect(el.props.title).toBe('Todos');
    expect(el.props.fabLabel).toBe('New todo');
    expect(el.props.fabHref).toBe('/todos/new');
  });

  it('preserves the q/list/tag/done params in the search box', async () => {
    const el = await TodosPage({
      searchParams: Promise.resolve({ q: 'milk', list: 'l1', tag: '1', done: 'false' }),
    });

    const search = el.props.search;
    expect(search.type).toBe(PreservingSearchBox);
    expect(search.props.path).toBe('/todos');
    expect(search.props.q).toBe('milk');
    expect(search.props.params).toEqual({ list: 'l1', tag: '1', done: 'false' });
  });

  it('passes the filter axes through to listTodos', async () => {
    await TodosPage({
      searchParams: Promise.resolve({ q: 'milk', list: 'l1', tag: '1', done: 'false' }),
    });

    expect(mockedListTodos).toHaveBeenCalledWith({
      q: 'milk',
      listId: 'l1',
      tagId: 1,
      done: false,
      cursor: undefined,
    });
  });

  it('renders the status pills with the active one matching the done param', async () => {
    const el = await TodosPage({
      searchParams: Promise.resolve({ q: 'milk', list: 'l1', tag: '1', done: 'false' }),
    });

    const status = find(el.props.filters, PillGroup, 'Status');
    expect(status.type).toBe(PillGroup);
    const pills = asArray(status);
    expect(pills.map((p) => p.props.children)).toEqual(['All', 'Open', 'Done']);
    expect(pills[0].type).toBe(Pill);
    expect(pills[0].props.active).toBe(false);
    expect(pills[1].props.active).toBe(true);
    expect(pills[2].props.active).toBe(false);
    expect(pills[0].props.href).toContain('q=milk');
    expect(pills[1].props.href).toContain('done=false');
    expect(pills[2].props.href).toContain('done=true');
  });

  it('hands the tag and list filters to TagFilterNav, preserving the current params', async () => {
    const el = await TodosPage({
      searchParams: Promise.resolve({ q: 'milk', list: 'l1', tag: '1', done: 'false' }),
    });

    const tagsNav = find(el.props.filters, TagFilterNav, 'Tags');
    expect(tagsNav.props.items.map((i: any) => i.name)).toEqual(['All tags', 'errand']);
    expect(tagsNav.props.items[1].active).toBe(true);
    expect(tagsNav.props.items[1].href).toContain('q=milk');
    expect(tagsNav.props.items[1].href).toContain('tag=1');

    const listsNav = find(el.props.filters, TagFilterNav, 'Lists');
    expect(listsNav.props.items.map((i: any) => i.name)).toEqual(['All lists', 'Groceries']);
    expect(listsNav.props.items[1].active).toBe(true);
  });

  it('keeps the frozen nav link labels the e2e suite depends on', async () => {
    const el = await TodosPage({ searchParams: Promise.resolve({}) });

    const trailing = asArray(el.props.navTrailing);
    const labels = trailing
      .filter((child) => child.type === IconLink)
      .map((child) => child.props.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Manage tags', 'Manage lists', 'Trash', 'Settings']),
    );
    expect(trailing.some((child) => child.type === ThemeToggle)).toBe(false);
  });

  it('renders the view tabs and the Matrix tab when the opt-in is on', async () => {
    mockedReadPref.mockResolvedValue(true);
    const el = await TodosPage({ searchParams: Promise.resolve({}) });

    const tabs = el.props.tabs;
    expect(tabs.type).toBe(TabBar);
    expect(tabs.props['aria-label']).toBe('Todos views');
    const tabEls = asArray(tabs);
    expect(tabEls.map((t) => t.props.children)).toEqual(['List', 'Matrix']);
    expect(tabEls[0].type).toBe(Tab);
    expect(tabEls[0].props.href).toBe('/todos');
    expect(tabEls[0].props.active).toBe(true);
    expect(tabEls[1].props.href).toBe('/todos/matrix');
    expect(tabEls[1].props.active).toBeFalsy();
  });

  it('renders no tabs node when the opt-in is off', async () => {
    const el = await TodosPage({ searchParams: Promise.resolve({}) });

    expect(el.props.tabs).toBeUndefined();
  });
});
