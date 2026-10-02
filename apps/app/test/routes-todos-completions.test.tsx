import type { List, TagUsage, Todo, TodoCompletion } from '@life/shared';
import { EmptyState, ListItem } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/todo-api', () => ({
  listTodos: jest.fn(),
  listTodoTagUsage: jest.fn(),
  listLists: jest.fn(),
  listTodoCompletions: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  listTags: jest.fn(),
  resolveTags: jest.fn(),
}));
// The barrel re-exports the server-only `readPref` (next/headers); mock it so the
// server module never loads under jest.
jest.mock('@/lib/preferences', () => ({ readPref: jest.fn() }));

import { listTodos, listTodoTagUsage, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags, resolveTags } from '@/lib/tags-api';
import { readPref } from '@/lib/preferences';
import TodosPage from '@/app/todos/page';
import { TodoList } from '@/app/todo-list';
import { TodoCompletionList } from '@/app/todo-completion-list';

const mockedListTodos = listTodos as jest.MockedFunction<typeof listTodos>;
const mockedUsage = listTodoTagUsage as jest.MockedFunction<typeof listTodoTagUsage>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListCompletions = listTodoCompletions as jest.MockedFunction<typeof listTodoCompletions>;
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

/**
 * Newest first, two occurrences of the same todo (`t1`) so "one row per
 * occurrence" is observable. Midday instants keep the date part stable across
 * realistic timezones; the dates are in a different year than "today" so the
 * label is never `Today`/`Tomorrow`.
 */
function completion(overrides: Partial<TodoCompletion> = {}): TodoCompletion {
  return {
    id: 'c1',
    todoId: 't1',
    occurrence: '2025-01-15',
    completedAt: '2025-01-15T12:00:00.000Z',
    title: 'Buy milk',
    listId: null,
    listName: null,
    ...overrides,
  };
}

const completions: TodoCompletion[] = [
  completion({
    id: 'c3',
    todoId: 't1',
    title: 'Buy milk',
    completedAt: '2025-09-27T12:00:00.000Z',
    listId: 'l1',
    listName: 'Groceries',
  }),
  completion({
    id: 'c2',
    todoId: 't2',
    title: 'Walk dog',
    completedAt: '2025-09-25T12:00:00.000Z',
    listId: 'l2',
    listName: 'Errands',
  }),
  completion({ id: 'c1', todoId: 't1', title: 'Buy milk', completedAt: '2025-01-15T12:00:00.000Z' }),
];

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe('/todos Done-view wiring', () => {
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
    mockedListCompletions.mockResolvedValue({ completions, nextCursor: null });
  });

  it('renders TodoCompletionList (not TodoList), one row per occurrence, newest first', async () => {
    const el = await TodosPage({ searchParams: Promise.resolve({ done: 'true' }) });

    expect(el.props.body.type).toBe(TodoCompletionList);
    expect(el.props.body.type).not.toBe(TodoList);

    const body = el.props.body;
    expect(body.props.completions).toEqual(completions);
    expect(mockedListCompletions).toHaveBeenCalledWith({ cursor: undefined });

    const list = TodoCompletionList({ completions: body.props.completions, today: body.props.today });
    const rows = asArray(list);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.props.title)).toEqual(['Buy milk', 'Walk dog', 'Buy milk']);
    expect(rows[0].props.href).toBe('/todos/t1/edit');
    expect(rows[1].props.href).toBe('/todos/t2/edit');
  });

  it('renders no done-toggle: no hideDone prop and no leading checkbox', async () => {
    const el = await TodosPage({ searchParams: Promise.resolve({ done: 'true' }) });

    const body = el.props.body;
    expect(body.props.hideDone).toBeUndefined();

    const rows = asArray(TodoCompletionList({ completions: body.props.completions, today: body.props.today }));
    for (const row of rows) {
      expect(row.type).toBe(ListItem);
      expect(row.props.leading).toBeUndefined();
      expect(row.props.deleteAction).toBeUndefined();
    }
    expect(renderToStaticMarkup(body)).not.toContain('ui-checkbox');
  });

  it('links each row to /todos/<todoId>/edit with title, completed date and list name', async () => {
    const el = await TodosPage({ searchParams: Promise.resolve({ done: 'true' }) });
    const body = el.props.body;

    const rows = asArray(TodoCompletionList({ completions: body.props.completions, today: body.props.today }));
    const walk = rows.find((r) => r.props.title === 'Walk dog');
    expect(walk.props.href).toBe('/todos/t2/edit');
    const meta = asArray(walk.props.meta);
    expect(meta[0].props.children).toContain('25/09/2025');
    expect(meta[1].props.children).toBe('Errands');

    const html = renderToStaticMarkup(body);
    expect(html).toContain('href="/todos/t2/edit"');
    expect(html).toContain('Walk dog');
    expect(html).toContain('25/09/2025');
    expect(html).toContain('Errands');
  });

  it('renders EmptyState heading "No completed todos" for an empty log', async () => {
    mockedListCompletions.mockResolvedValue({ completions: [], nextCursor: null });
    const el = await TodosPage({ searchParams: Promise.resolve({ done: 'true' }) });

    const body = el.props.body;
    expect(body.props.completions).toEqual([]);
    const empty = TodoCompletionList({ completions: [], today: body.props.today });
    expect(empty.type).toBe(EmptyState);
    expect(empty.props.heading).toBe('No completed todos');
    expect(renderToStaticMarkup(body)).toContain('No completed todos');
  });

  it('still renders TodoList from todo.done for All/Open', async () => {
    const all = await TodosPage({ searchParams: Promise.resolve({}) });
    expect(all.props.body.type).toBe(TodoList);
    expect(all.props.body.props.hideDone).toBe(true);

    const open = await TodosPage({ searchParams: Promise.resolve({ done: 'false' }) });
    expect(open.props.body.type).toBe(TodoList);
    expect(open.props.body.props.hideDone).toBe(true);

    expect(mockedListCompletions).not.toHaveBeenCalled();
  });
});
