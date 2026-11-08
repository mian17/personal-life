import type { List, Todo } from '@life/shared';
import { List as UiList, ListShell, MatrixBlock, Tab, TabBar, todayIso } from '@life/ui';

jest.mock('@/lib/preferences', () => ({ readPref: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));
jest.mock('@/lib/todo-api', () => ({ listTodos: jest.fn(), listLists: jest.fn() }));
// `notFound()` throws in a real request; keep next/headers (readPref) and the router
// out of the node env while making the gate observable.
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { listTodos, listLists } from '@/lib/todo-api';
import { readPref } from '@/lib/preferences';
import { getToday } from '@/lib/today';
import TodosMatrixPage from '@/app/todos/matrix/page';
import { TodosNav } from '@/app/todos-nav';

const mockedListTodos = listTodos as jest.MockedFunction<typeof listTodos>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedReadPref = readPref as jest.MockedFunction<typeof readPref>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

const TODAY = todayIso();

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

describe('/todos/matrix page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTodos.mockResolvedValue({
      todos: [
        todo({ id: 'ui-1', title: 'Urgent important', dueDate: TODAY, effectiveImportant: true }),
        todo({ id: 'un-1', title: 'Urgent', dueDate: TODAY, effectiveImportant: false }),
        todo({ id: 'ni-1', title: 'Important', dueDate: null, effectiveImportant: true }),
        todo({ id: 'nn-1', title: 'Neither', dueDate: null, effectiveImportant: false }),
      ],
      nextCursor: null,
      total: 4,
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
    mockedReadPref.mockResolvedValue(true);
    mockedGetToday.mockResolvedValue(TODAY);
  });

  it('returns notFound when the opt-in is off', async () => {
    mockedReadPref.mockResolvedValue(false);

    await expect(TodosMatrixPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockedReadPref).toHaveBeenCalledWith('matrix');
    expect(mockedListTodos).not.toHaveBeenCalled();
  });

  it('renders the four MatrixBlock quadrants in groupByQuadrant order', async () => {
    const el = await TodosMatrixPage();

    expect(el.type).toBe(ListShell);
    expect(el.props.title).toBe('Matrix');
    const block = el.props.body;
    expect(block.type).toBe(MatrixBlock);

    const quadrants = block.props.quadrants;
    expect(quadrants.map((q: any) => q.id)).toEqual([
      'urgent-important',
      'urgent-not-important',
      'not-urgent-important',
      'not-urgent-not-important',
    ]);
    expect(quadrants.map((q: any) => q.label)).toEqual([
      'Urgent & Important',
      'Urgent & Not Important',
      'Not Urgent & Important',
      'Not Urgent & Not Important',
    ]);
    expect(quadrants.map((q: any) => q.tone)).toEqual(['danger', 'amber', 'accent', 'green']);

    const itemsByQuadrant = Object.fromEntries(
      quadrants.map((q: any) => {
        expect(q.items.type).toBe(UiList);
        return [
          q.id,
          asArray(q.items).map((row: any) => row.props.todo.id),
        ];
      }),
    );
    expect(itemsByQuadrant).toEqual({
      'urgent-important': ['ui-1'],
      'urgent-not-important': ['un-1'],
      'not-urgent-important': ['ni-1'],
      'not-urgent-not-important': ['nn-1'],
    });

    for (const q of quadrants) {
      for (const row of asArray(q.items)) {
        expect(row.props.size).toBe('dense');
      }
    }
  });

  it('tints each matrix row by its quadrant, leaving quadrant IV untinted', async () => {
    const el = await TodosMatrixPage();
    const quadrants = el.props.body.props.quadrants;
    const byId = Object.fromEntries(quadrants.map((q: any) => [q.id, q]));

    const rowTone = (id: string) =>
      asArray(byId[id].items)[0].props.tone;

    expect(rowTone('urgent-important')).toBe('danger');
    expect(rowTone('urgent-not-important')).toBe('amber');
    expect(rowTone('not-urgent-important')).toBe('accent');
    expect(rowTone('not-urgent-not-important')).toBeUndefined();
  });

  it('passes items: null and the empty copy for quadrants with no todos', async () => {
    mockedListTodos.mockResolvedValue({
      todos: [todo({ id: 'nn-1', dueDate: null, effectiveImportant: false })],
      nextCursor: null,
      total: 1,
    });

    const el = await TodosMatrixPage();
    const quadrants = el.props.body.props.quadrants;
    const byId = Object.fromEntries(quadrants.map((q: any) => [q.id, q]));

    expect(byId['not-urgent-not-important'].items.type).toBe(UiList);
    for (const id of ['urgent-important', 'urgent-not-important', 'not-urgent-important']) {
      expect(byId[id].items).toBeNull();
      expect(byId[id].empty).toBe('No tasks');
    }
  });

  it('excludes done todos from every quadrant', async () => {
    mockedListTodos.mockResolvedValue({
      todos: [
        todo({ id: 'open-1', dueDate: TODAY, effectiveImportant: true }),
        todo({ id: 'done-1', title: 'Done task', done: true, dueDate: TODAY, effectiveImportant: true }),
      ],
      nextCursor: null,
      total: 2,
    });

    const el = await TodosMatrixPage();
    const quadrants = el.props.body.props.quadrants;
    const ids = quadrants.flatMap((q: any) =>
      q.items ? asArray(q.items).map((row: any) => row.props.todo.id) : [],
    );

    expect(ids).toContain('open-1');
    expect(ids).not.toContain('done-1');
  });

  it('marks Matrix active and List not active', async () => {
    const el = await TodosMatrixPage();

    const tabs = el.props.tabs;
    expect(tabs.type).toBe(TabBar);
    expect(tabs.props['aria-label']).toBe('Todos views');
    const tabEls = asArray(tabs);
    expect(tabEls.map((t) => t.props.children)).toEqual(['Today', 'Matrix']);
    expect(tabEls[0].type).toBe(Tab);
    expect(tabEls[0].props.href).toBe('/todos');
    expect(tabEls[0].props.active).toBeFalsy();
    expect(tabEls[1].type).toBe(Tab);
    expect(tabEls[1].props.href).toBe('/todos/matrix');
    expect(tabEls[1].props.active).toBe(true);
  });

  it('subtitles the header with the matrix grid’s own open and done counts', async () => {
    mockedListTodos.mockResolvedValue({
      todos: [
        todo({ id: 'ui-1', dueDate: TODAY, effectiveImportant: true }),
        todo({ id: 'un-1', dueDate: TODAY, effectiveImportant: false }),
        todo({ id: 'nn-1', dueDate: null, effectiveImportant: false }),
        todo({ id: 'done-1', dueDate: TODAY, effectiveImportant: true, done: true }),
        todo({ id: 'done-2', dueDate: null, effectiveImportant: false, done: true }),
      ],
      nextCursor: null,
      total: 5,
    });

    const el = await TodosMatrixPage();

    expect(el.props.subtitle).toBe('3 open \u00b7 2 done');
    const quadrants = el.props.body.props.quadrants;
    const renderedRows = quadrants.flatMap((q: any) =>
      q.items ? asArray(q.items).map((row: any) => row.props.todo.id) : [],
    );
    expect(renderedRows).toHaveLength(3);
  });

  it('subtitles an empty matrix 0 open \u00b7 0 done', async () => {
    mockedListTodos.mockResolvedValue({ todos: [], nextCursor: null, total: 0 });

    const el = await TodosMatrixPage();

    expect(el.props.subtitle).toBe('0 open \u00b7 0 done');
  });

  it('keeps the fab and the todos toolbar, and omits search/filters', async () => {
    const el = await TodosMatrixPage();

    expect(el.props.fabHref).toBe('/todos/new');
    expect(el.props.fabLabel).toBe('New todo');
    expect(el.props.fill).toBe(true);
    expect(el.props.search).toBeUndefined();
    expect(el.props.filters).toBeUndefined();
    expect(el.props.navTrailing.type).toBe(TodosNav);
  });
});
