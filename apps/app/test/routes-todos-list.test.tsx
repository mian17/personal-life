import type { List, Todo, TodoCompletion } from '@life/shared';
import { dueDateLabel, ListShell, SettingsLink, Tab, TabBar, todayIso } from '@life/ui';
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
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { listTodos, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { readPref } from '@/lib/preferences';
import { getToday } from '@/lib/today';
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
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

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
    mockedGetToday.mockResolvedValue(todayIso());
  });

  it('renders ListShell titled Today with the frozen fab label', async () => {
    const el = await TodosPage();

    expect(el.type).toBe(ListShell);
    expect(el.props.title).toBe('Today');
    expect(el.props.fabLabel).toBe('New todo');
    expect(el.props.fabHref).toBe('/todos/new');
  });

  it('subtitles the header with the day\u2019s open and done rows, zero included', async () => {
    // The default fixture's only todo is undated, so it lands in no shown group: the
    // header still reads the literal, no-plural zero form.
    const el = await TodosPage();

    expect(el.props.subtitle).toBe('0 open \u00b7 0 done');
  });

  it('counts open as overdue + today and done as the done rows, including derived occurrences', async () => {
    const TODAY = todayIso();
    mockedListTodos.mockResolvedValue({
      todos: [
        todo({ id: 'o1', title: 'Send meter reading', dueDate: '2000-01-01' }),
        todo({ id: 't1', title: 'Write the report', dueDate: TODAY }),
        todo({ id: 'd1', title: 'Pay rent', done: true }),
        todo({ id: 'rep', title: 'Water plants', repeat: 'daily', dueDate: TODAY }),
      ],
      nextCursor: null,
    });
    // The repeating todo's ticked occurrence is a done row with no `Todo` row of its own.
    mockedListTodoCompletions.mockResolvedValue({
      completions: [completion({ id: 'c1', todoId: 'rep', occurrence: '2026-10-01' })],
      nextCursor: null,
    });

    const el = await TodosPage();

    // open: overdue (1) + today (1, the live repeating row); done: the done one-off
    // plus the derived occurrence the completion log makes a done row.
    expect(el.props.subtitle).toBe('3 open \u00b7 2 done');
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

  it('keeps the nav to the single settings control: the tags/lists/trash icons are gone', async () => {
    const el = await TodosPage();

    expect(el.props.navTrailing.type).toBe(TodosNav);
    const nav = TodosNav() as unknown as { type: unknown; props: { href: string } };
    expect(nav.type).toBe(SettingsLink);
    expect(nav.props.href).toBe('/todos/settings');

    const html = renderToStaticMarkup(<TodosNav />);
    expect(html).not.toMatch(/Theme:/);
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Settings']);
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

  it('opens a zero-row body one section step down, wrapping the empty state in a section', async () => {
    mockedListTodos.mockResolvedValue({ todos: [], nextCursor: null });
    const el = await TodosPage();
    const html = renderToStaticMarkup(el.props.body);

    // The empty state is not left flush under the tabs: it rides the section primitive,
    // whose own `--s6` top step is the page's rhythm. `autoHideStyles` cannot hide it —
    // the section holds an empty state, never a `.ui-list`.
    expect(html).toMatch(/<section[^>]*class="[^"]*ui-section/);
    expect(html).toContain('ui-empty');
    expect(html).toContain('No todos');
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

  it("renders a repeating todo's completed occurrence as a done TodoItem while the next occurrence stays open", async () => {
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

    // The completed occurrence is a done row through the SAME TodoItem as every
    // other Done row: muted/struck, its ticked toggle offers undo, and its meta
    // shows the DUE date the tick satisfied (never the click timestamp).
    expect(html).toContain('Water plants');
    expect(html).toContain('ui-list-item--done');
    expect(html).toContain('ui-checkbox--checked');
    expect(html).toContain('Mark Water plants not done');
    expect(html).toContain(dueDateLabel(occurrence, todayIso()));
    expect(html).not.toContain(dueDateLabel(completedAt, todayIso()));

    // The live repeating todo keeps its next occurrence open, also a TodoItem.
    expect(html).toContain('Mark Water plants done');
  });
});

describe('/todos list row tint', () => {
  const TODAY = todayIso();

  function rowClasses(html: string, title: string): string[] {
    const row = html.split('<li ').find((chunk) => chunk.includes(`>${title}<`));
    if (!row) throw new Error(`no row rendered for "${title}"`);
    const classAttr = row.slice(0, row.indexOf('>')).match(/class="([^"]*)"/)?.[1] ?? '';
    return classAttr.split(/\s+/).filter(Boolean);
  }

  it('tints Overdue/Today rows by quadrant and leaves Done rows untinted', async () => {
    mockedListTodos.mockResolvedValue({
      todos: [
        todo({ id: 'oi', title: 'Overdue important', dueDate: '2000-01-01', effectiveImportant: true }),
        todo({ id: 'tn', title: 'Today not important', dueDate: TODAY, effectiveImportant: false }),
        todo({ id: 'di', title: 'Done important', dueDate: '2000-01-01', effectiveImportant: true, done: true }),
        todo({ id: 'dn', title: 'Done neither', dueDate: null, effectiveImportant: false, done: true }),
      ],
      nextCursor: null,
    });

    const el = await TodosPage();
    const html = renderToStaticMarkup(el.props.body);

    // Overdue + important → danger (quadrant I); Today + not important → amber (II).
    expect(rowClasses(html, 'Overdue important')).toContain('ui-list-item--danger');
    expect(rowClasses(html, 'Today not important')).toContain('ui-list-item--amber');

    // Done rows stay muted and untinted — even a would-be quadrant I row, plus
    // quadrant IV, carries no tone class.
    for (const title of ['Done important', 'Done neither']) {
      const classes = rowClasses(html, title);
      expect(classes).toContain('ui-list-item--done');
      expect(classes).not.toContain('ui-list-item--danger');
      expect(classes).not.toContain('ui-list-item--amber');
      expect(classes).not.toContain('ui-list-item--accent');
    }
  });
});
