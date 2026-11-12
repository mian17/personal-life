import type { List, Todo, TodoCompletion, TodoPage } from '@life/shared';
import { dueDateLabel, SettingsLink, todayIso } from '@life/ui';
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
import { TodosScroll, describeTodosHeader } from '@/app/todos/todos-scroll';
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
    originService: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
    ...overrides,
  };
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

function page(todos: Todo[], nextCursor: string | null = null, total = todos.length): TodoPage {
  return { todos, nextCursor, total };
}

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

/** The screen's markup: the page's element, server-rendered exactly as first paint is. */
async function renderScreen(): Promise<string> {
  const el = await TodosPage();
  return renderToStaticMarkup(el);
}

describe('/todos list page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTodos.mockResolvedValue(
      page([todo({ id: 't1', title: 'Buy milk', listId: 'l1', tagIds: [1] })]),
    );
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
    mockedListTodoCompletions.mockResolvedValue({ completions: [], nextCursor: null, total: 0 });
    mockedReadPref.mockResolvedValue(false);
    mockedGetToday.mockResolvedValue(todayIso());
  });

  it('renders ListShell titled Today with the frozen fab label', async () => {
    const el = await TodosPage();

    expect(el.type).toBe(TodosScroll);
    const html = renderToStaticMarkup(el);
    expect(html).toContain('>Today<');
    expect(html).toContain('aria-label="New todo"');
    expect(html).toContain('href="/todos/new"');
  });

  it('reads exactly page 1 of todos on the server, and no todo cursor walk', async () => {
    await TodosPage();

    // One request: the rest of the list is the island's job, by cursor.
    expect(mockedListTodos).toHaveBeenCalledTimes(1);
    expect(mockedListTodos).toHaveBeenCalledWith();
  });

  it('walks the completion log whole, so the lookup is complete before any page renders', async () => {
    mockedListTodos.mockResolvedValue(page([todo()], 'todo-cursor-2', 2));
    mockedListTodoCompletions
      .mockResolvedValueOnce({
        completions: [completion({ id: 'c9' })],
        nextCursor: 'log-2',
        total: 2,
      })
      .mockResolvedValueOnce({
        completions: [completion({ id: 'c1', todoId: 't1' })],
        nextCursor: null,
        total: 2,
      });

    const el = await TodosPage();

    // The log is not paged: both pages arrive, so a completion far down it still pairs
    // with its todo on the very first screen.
    expect(mockedListTodoCompletions).toHaveBeenCalledTimes(2);
    expect(el.props.completions.map((c: TodoCompletion) => c.id)).toEqual(['c9', 'c1']);
  });

  it('subtitles the header with loaded-of-total rows, zero included', async () => {
    const html = await renderScreen();

    // The fixture's only todo is undated, so it lands in no shown group while still being a
    // loaded row: the count is truthful about the list and about the buckets both.
    expect(html).toContain('1 of 1 todos \u00b7 0 open \u00b7 0 done');
  });

  it('counts open as overdue + today and done as the done rows, including derived occurrences', async () => {
    const TODAY = todayIso();
    mockedListTodos.mockResolvedValue(
      page(
        [
          todo({ id: 'o1', title: 'Send meter reading', dueDate: '2000-01-01' }),
          todo({ id: 't1', title: 'Write the report', dueDate: TODAY }),
          todo({ id: 'd1', title: 'Pay rent', done: true }),
          todo({ id: 'rep', title: 'Water plants', repeat: 'daily', dueDate: TODAY }),
        ],
        null,
        4,
      ),
    );
    // The repeating todo's ticked occurrence is a done row with no `Todo` row of its own.
    mockedListTodoCompletions.mockResolvedValue({
      completions: [completion({ id: 'c1', todoId: 'rep', occurrence: '2026-10-01' })],
      nextCursor: null,
      total: 1,
    });

    const html = await renderScreen();

    // open: overdue (1) + today (1, the live repeating row); done: the done one-off
    // plus the derived occurrence the completion log makes a done row.
    expect(html).toContain('4 of 4 todos \u00b7 3 open \u00b7 2 done');
  });

  it('offers one load-more control while a next cursor exists, and none once exhausted', async () => {
    mockedListTodos.mockResolvedValue(page([todo()], 'todo-cursor-2', 2));
    expect(await renderScreen()).toMatch(/>Load more</);

    mockedListTodos.mockResolvedValue(page([todo()], null, 1));
    expect(await renderScreen()).not.toContain('Load more');
  });

  it('renders no search box and no filter slots', async () => {
    mockedReadPref.mockResolvedValue(false);
    const html = await renderScreen();

    expect(html).not.toContain('Search todos');
    expect(html).not.toContain('ui-tag-filter');
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
    const tabEls = asArray(tabs);
    expect(tabs.props['aria-label']).toBe('Todos views');
    expect(tabEls.map((t) => t.props.children)).toEqual(['Today', 'Matrix']);
    expect(tabEls[0].props.href).toBe('/todos');
    expect(tabEls[0].props.active).toBe(true);
    expect(tabEls[1].props.href).toBe('/todos/matrix');
  });

  it('renders no tabs node when the opt-in is off', async () => {
    const el = await TodosPage();

    expect(el.props.tabs).toBeUndefined();
  });

  it('opens a zero-row body one section step down, wrapping the empty state in a section', async () => {
    mockedListTodos.mockResolvedValue(page([], null, 0));
    const html = await renderScreen();

    // The empty state is not left flush under the tabs: it rides the section primitive,
    // whose own `--s6` top step is the page's rhythm. `autoHideStyles` cannot hide it —
    // the section holds an empty state, never a `.ui-list`.
    expect(html).toMatch(/<section[^>]*class="[^"]*ui-section/);
    expect(html).toContain('ui-empty');
    expect(html).toContain('No todos');
    expect(html).toContain('0 of 0 todos \u00b7 0 open \u00b7 0 done');
  });

  it('renders a done todo struck, with no delete control', async () => {
    mockedListTodos.mockResolvedValue(page([todo({ id: 'd1', title: 'Pay rent', done: true })]));
    const html = await renderScreen();

    expect(html).toContain('ui-list-item--done');
    expect(html).toContain('ui-checkbox--checked');
    // Deleting moved to the todo's own detail page, so neither state of the row renders a
    // trash form: the list is a pure index again.
    expect(html).not.toContain('aria-label="Delete');
    expect(html).not.toContain('ui-btn--danger');
    expect(html).not.toContain('<form');
  });

  it("renders a repeating todo's completed occurrence as a done TodoItem while the next occurrence stays open", async () => {
    const occurrence = '2026-10-01';
    const completedAt = '2026-10-02T09:30:00.000Z';
    mockedListTodos.mockResolvedValue(
      page([todo({ id: 'rep', title: 'Water plants', repeat: 'daily', dueDate: '2026-01-01' })]),
    );
    mockedListTodoCompletions.mockResolvedValue({
      completions: [
        completion({ id: 'c1', todoId: 'rep', title: 'Water plants', occurrence, completedAt }),
      ],
      nextCursor: null,
      total: 1,
    });

    const html = await renderScreen();

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

  it("names a robot-made row's producer, and leaves the user's own rows unattributed", async () => {
    // Dated today so both rows land in the shown Today group: an undated todo is in no
    // group and renders nothing, which would make the absence assertion pass for the
    // wrong reason.
    mockedListTodos.mockResolvedValue(
      page([
        todo({ id: 'm1', title: 'Prep lunch', dueDate: todayIso(), originService: 'meal-service' }),
        todo({ id: 'u1', title: 'Buy milk', dueDate: todayIso() }),
      ]),
    );

    const html = await renderScreen();
    const rowOf = (title: string): string => {
      const row = html
        .split('<li ')
        .map((chunk) => chunk.slice(0, chunk.indexOf('</li>')))
        .find((chunk) => chunk.includes(`>${title}<`));
      if (!row) throw new Error(`no row rendered for "${title}"`);
      return row;
    };

    // Attribution is the app's name for the producer, never the stored slug: a task
    // meal-service created must not read as one the user wrote.
    expect(rowOf('Prep lunch')).toContain('from Meals');
    // The fixture's default origin is null — the user's own todo claims no producer.
    expect(rowOf('Buy milk')).not.toContain('from ');
  });
});

/**
 * The island's own contract. A repeating todo's done row is derived from the live todo plus the
 * complete completion lookup, never from which todo page happens to be loaded: `groupTodos` is
 * re-run over the merged rows on every render with that same lookup, so an appended page can add
 * rows and cannot change another row's done state.
 */
describe('/todos scroll island', () => {
  const TODAY = todayIso();
  const loadPage = jest.fn<Promise<TodoPage>, [string]>();

  const repeating = todo({ id: 'rep', title: 'Water plants', repeat: 'daily', dueDate: TODAY });
  const ticked = completion({ id: 'c1', todoId: 'rep', occurrence: '2026-10-01' });

  function island(props: { nextCursor: string | null; completions: TodoCompletion[] }): string {
    return renderToStaticMarkup(
      <TodosScroll
        todos={[repeating]}
        nextCursor={props.nextCursor}
        total={2}
        completions={props.completions}
        today={TODAY}
        lists={[]}
        availableTags={[]}
        navTrailing={<TodosNav />}
        tabs={undefined}
        loadPage={loadPage}
      />,
    );
  }

  it('reads a ticking todo as done on page 1, and identically when more todo pages remain', () => {
    // THE KEY CASE: the tick lives far down the completion log (page 2 of it), yet the row is
    // done on the first screen — and stays done with a todo cursor still open, because the
    // done state is a function of the todo, not of how much of the list has been scrolled.
    const lastPage = island({ nextCursor: null, completions: [ticked] });
    const firstPage = island({ nextCursor: 'todo-cursor-2', completions: [ticked] });

    for (const html of [firstPage, lastPage]) {
      expect(html).toContain('Mark Water plants not done');
      expect(html).toContain('ui-list-item--done');
    }
    // The rows and their buckets are the same markup on both; only the control differs.
    expect(firstPage.replace('>Load more<', '')).not.toContain('Load more');
    expect(lastPage).not.toContain('Load more');
  });

  it('renders the control through the same cursor rule the page feeds it', () => {
    expect(island({ nextCursor: 'todo-cursor-2', completions: [] })).toMatch(/>Load more</);
    expect(island({ nextCursor: null, completions: [] })).not.toContain('Load more');
  });

  it('states the count over the loaded rows against the whole-list total', () => {
    // One loaded row of the two the list holds: the denominator is the envelope's `total`,
    // the buckets are the loaded rows — so the line grows as pages append.
    expect(island({ nextCursor: 'todo-cursor-2', completions: [ticked] })).toContain(
      '1 of 2 todos \u00b7 1 open \u00b7 1 done',
    );

    expect(
      describeTodosHeader(
        [
          { key: 'overdue', label: 'Overdue', todos: [repeating, repeating] },
          { key: 'today', label: 'Today', todos: [] },
          { key: 'done', label: 'Done', todos: [repeating] },
        ],
        12,
        40,
      ),
    ).toBe('12 of 40 todos \u00b7 2 open \u00b7 1 done');
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
    mockedListTodos.mockResolvedValue(
      page([
        todo({
          id: 'oi',
          title: 'Overdue important',
          dueDate: '2000-01-01',
          effectiveImportant: true,
        }),
        todo({ id: 'tn', title: 'Today not important', dueDate: TODAY, effectiveImportant: false }),
        todo({
          id: 'di',
          title: 'Done important',
          dueDate: '2000-01-01',
          effectiveImportant: true,
          done: true,
        }),
        todo({
          id: 'dn',
          title: 'Done neither',
          dueDate: null,
          effectiveImportant: false,
          done: true,
        }),
      ]),
    );

    const html = await renderScreen();

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
