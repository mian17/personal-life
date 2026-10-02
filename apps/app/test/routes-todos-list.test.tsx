import type { List, Todo, TodoCompletion } from '@life/shared';
import { dueDateLabel, ListShell, Tab, TabBar, todayIso } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/todo-api', () => ({
  listTodos: jest.fn(),
  listLists: jest.fn(),
  listTodoCompletions: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  listTags: jest.fn(),
}));
// The barrel re-exports the server-only `readPref` (next/headers); mock it so the
// server module never loads under jest.
jest.mock('@/lib/preferences', () => ({ readPref: jest.fn() }));

import { listTodos, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { readPref } from '@/lib/preferences';
import TodosPage from '@/app/todos/page';
import { TodoList } from '@/app/todo-list';
import { TodosNav } from '@/app/todos-nav';

const mockedListTodos = listTodos as jest.MockedFunction<typeof listTodos>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListTodoCompletions = listTodoCompletions as jest.MockedFunction<
  typeof listTodoCompletions
>;
const mockedListTags = listTags as jest.MockedFunction<typeof listTags>;
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
    repeat: null,
    repeatDays: null,
    reminderScheduledAt: null,
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

function completion(overrides: Partial<TodoCompletion> = {}): TodoCompletion {
  return {
    id: 'c1',
    todoId: 't1',
    occurrence: '2026-10-01',
    completedAt: '2026-10-02T09:30:00.000Z',
    title: 'Buy milk',
    listId: null,
    listName: null,
    ...overrides,
  };
}

describe('/todos list page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTodos.mockResolvedValue({
      todos: [todo({ id: 't1', title: 'Buy milk', listId: 'l1', tagIds: [1] })],
      nextCursor: null,
    });
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
    mockedListTodoCompletions.mockResolvedValue({ completions: [], nextCursor: null });
    mockedReadPref.mockResolvedValue(false);
  });

  it('renders ListShell titled Today with the frozen fab label', async () => {
    const el = await TodosPage();

    expect(el.type).toBe(ListShell);
    expect(el.props.title).toBe('Today');
    expect(el.props.fabLabel).toBe('New todo');
    expect(el.props.fabHref).toBe('/todos/new');
  });

  it('passes no filter or search axes through to listTodos', async () => {
    await TodosPage();

    expect(mockedListTodos).toHaveBeenCalledWith({ cursor: undefined });
  });

  it('renders no search box and no filter slots', async () => {
    const el = await TodosPage();

    expect(el.props.search).toBeUndefined();
    expect(el.props.filters).toBeUndefined();
  });

  it('keeps the frozen nav link labels the e2e suite depends on', async () => {
    const el = await TodosPage();

    expect(el.props.navTrailing.type).toBe(TodosNav);
    const html = renderToStaticMarkup(<TodosNav />);
    expect(html).not.toMatch(/Theme:/);
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(
      expect.arrayContaining(['Manage tags', 'Manage lists', 'Trash', 'Settings']),
    );
  });

  it('renders the view tabs and the Matrix tab when the opt-in is on', async () => {
    mockedReadPref.mockResolvedValue(true);
    const el = await TodosPage();

    const tabs = el.props.tabs;
    expect(tabs.type).toBe(TabBar);
    expect(tabs.props['aria-label']).toBe('Todos views');
    const tabEls = asArray(tabs);
    expect(tabEls.map((t) => t.props.children)).toEqual(['Today', 'Matrix']);
    expect(tabEls[0].type).toBe(Tab);
    expect(tabEls[0].props.href).toBe('/todos');
    expect(tabEls[0].props.active).toBe(true);
    expect(tabEls[1].props.href).toBe('/todos/matrix');
    expect(tabEls[1].props.active).toBeFalsy();
  });

  it('renders no tabs node when the opt-in is off', async () => {
    const el = await TodosPage();

    expect(el.props.tabs).toBeUndefined();
  });

  it('always renders TodoList as the body — no Done-view body swap', async () => {
    const el = await TodosPage();

    expect(el.props.body.type).toBe(TodoList);
    expect(el.props.body.props.hideDone).toBeUndefined();
  });

  it('renders a done todo as a struck row with no trash control', async () => {
    mockedListTodos.mockResolvedValue({
      todos: [todo({ id: 'd1', title: 'Pay rent', done: true })],
      nextCursor: null,
    });
    const el = await TodosPage();

    const html = renderToStaticMarkup(el.props.body);
    expect(html).toContain('ui-list-item--done');
    expect(html).toContain('ui-checkbox--checked');
    expect(html).not.toContain('ui-btn--danger');
    expect(html).not.toContain('aria-label="Delete Pay rent"');
  });

  it("surfaces a repeating todo's completed occurrence in Done while the next occurrence stays open", async () => {
    const occurrence = '2026-10-01';
    const completedAt = '2026-10-02T09:30:00.000Z';
    mockedListTodos.mockResolvedValue({
      todos: [todo({ id: 'rep', title: 'Water plants', repeat: 'daily', dueDate: '2026-01-01' })],
      nextCursor: null,
    });
    mockedListTodoCompletions.mockResolvedValue({
      completions: [
        completion({ id: 'c1', todoId: 'rep', title: 'Water plants', occurrence, completedAt }),
      ],
      nextCursor: null,
    });

    const el = await TodosPage();
    const html = renderToStaticMarkup(el.props.body);

    // The completed occurrence renders as a PLAIN row: title + the DUE date the
    // tick satisfied, with no strike/done variant anywhere (the only todo present
    // is open).
    expect(html).toContain('Water plants');
    expect(html).toContain(dueDateLabel(occurrence, todayIso()));
    expect(html).not.toContain(dueDateLabel(completedAt, todayIso()));
    expect(html).not.toContain('ui-list-item--done');

    // The live repeating todo keeps its next occurrence open: its toggle offers
    // to mark it done, and nothing renders it as already done.
    expect(html).toContain('Mark Water plants done');
    expect(html).not.toContain('Mark Water plants not done');
  });
});
