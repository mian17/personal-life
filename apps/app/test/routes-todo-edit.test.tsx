import type { List, Todo } from '@life/shared';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    (error as { digest?: string }).digest = 'NEXT_NOT_FOUND';
    throw error;
  }),
  useRouter: () => ({
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));
jest.mock('@/lib/todo-api', () => ({
  getTodo: jest.fn(),
  listLists: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  listTags: jest.fn(),
}));

import { notFound } from 'next/navigation';
import { getTodo, listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import EditTodoPage from '@/app/todos/[id]/edit/page';
import { TodoEditor } from '@/app/todo-editor';

const mockedGetTodo = getTodo as jest.MockedFunction<typeof getTodo>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListTags = listTags as jest.MockedFunction<typeof listTags>;
const mockedNotFound = notFound as jest.MockedFunction<typeof notFound>;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: 'two litres',
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: '2026-10-02',
    listId: 'l1',
    tagIds: [7],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 3,
    ...overrides,
  };
}

describe('/todos/[id]/edit page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      { id: 7, name: 'errand', version: 0, createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('loads the todo through loadOrNotFound and feeds the editor', async () => {
    const fixture = todo();
    mockedGetTodo.mockResolvedValue(fixture);

    const el = await EditTodoPage({ params: Promise.resolve({ id: 't1' }) });

    expect(mockedGetTodo).toHaveBeenCalledWith('t1');
    expect(el.type).toBe(TodoEditor);
    expect(el.props.todo).toBe(fixture);
    expect(el.props.lists).toEqual([
      {
        id: 'l1',
        name: 'Groceries',
        importantDefault: null,
        version: 0,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(el.props.availableTags).toEqual([{ id: 7, name: 'errand' }]);
  });

  it('renders the edit-mode title and save action labels', async () => {
    mockedGetTodo.mockResolvedValue(todo());

    const el = await EditTodoPage({ params: Promise.resolve({ id: 't1' }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Edit Todo');
    expect(html).toContain('aria-label="Save todo"');
  });

  it('renders the create-mode title and add action labels for a new todo', () => {
    const html = renderToStaticMarkup(<TodoEditor lists={[]} availableTags={[]} />);

    expect(html).toContain('New Todo');
    expect(html).toContain('aria-label="Add todo"');
  });

  it('routes a 404-shaped loader failure through notFound()', async () => {
    mockedGetTodo.mockRejectedValue({ status: 404, message: 'gone' });

    await expect(
      EditTodoPage({ params: Promise.resolve({ id: 'missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockedNotFound).toHaveBeenCalled();
    expect(mockedListLists).not.toHaveBeenCalled();
  });

  it('rethrows a non-404 failure without calling notFound()', async () => {
    mockedGetTodo.mockRejectedValue({ status: 500, message: 'boom' });

    await expect(
      EditTodoPage({ params: Promise.resolve({ id: 't1' }) }),
    ).rejects.toEqual({ status: 500, message: 'boom' });

    expect(mockedNotFound).not.toHaveBeenCalled();
  });
});
