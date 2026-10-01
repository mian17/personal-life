import type { Todo } from '@life/shared';
import { LocalTime, TrashBlock } from '@life/ui';

jest.mock('@/lib/todo-api', () => ({
  listTodoTrash: jest.fn(),
}));
jest.mock('@/app/todo-actions', () => ({
  restoreTodoAction: jest.fn(),
  deleteForeverTodoAction: jest.fn(),
  emptyTodoTrashAction: jest.fn(),
}));

import { listTodoTrash } from '@/lib/todo-api';
import {
  deleteForeverTodoAction,
  emptyTodoTrashAction,
  restoreTodoAction,
} from '@/app/todo-actions';
import TrashPage from '@/app/todos/trash/page';

const mockedListTrash = listTodoTrash as jest.MockedFunction<typeof listTodoTrash>;
const mockedRestore = restoreTodoAction as jest.MockedFunction<typeof restoreTodoAction>;
const mockedDeleteForever = deleteForeverTodoAction as jest.MockedFunction<
  typeof deleteForeverTodoAction
>;
const mockedEmpty = emptyTodoTrashAction as jest.MockedFunction<typeof emptyTodoTrashAction>;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: 'from the shop',
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: null,
    listId: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: '2026-09-30T10:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

describe('/todos/trash page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTrash.mockResolvedValue({
      todos: [
        todo({ id: 't1', title: 'Buy milk', note: 'from the shop' }),
        todo({
          id: 't2',
          title: 'Call mum',
          note: null,
          deletedAt: null,
        }),
      ],
      nextCursor: null,
    });
  });

  it('renders TrashBlock with the frozen title/back and copy', async () => {
    const el = await TrashPage();

    expect(el.type).toBe(TrashBlock);
    expect(el.props.title).toBe('Trash');
    expect(el.props.backHref).toBe('/todos');
    expect(el.props.emptyMessage).toBe('Trash is empty.');
    expect(el.props.emptyTrashMessage).toBe(
      'Permanently delete all todos in trash? This cannot be undone.',
    );
    expect(el.props.deleteForeverMessage(el.props.items[0])).toBe(
      'Delete this todo forever? This cannot be undone.',
    );
  });

  it('maps every todo fixture to a row (title, snippet, deleted-at meta)', async () => {
    const el = await TrashPage();
    const items = el.props.items;

    expect(items.map((i: any) => i.id)).toEqual(['t1', 't2']);
    expect(items[0].title).toBe('Buy milk');
    expect(items[0].snippet).toBe('from the shop');
    expect(items[0].meta.type).toBe(LocalTime);
    expect(items[0].meta.props.dateTime).toBe('2026-09-30T10:00:00.000Z');

    expect(items[1].title).toBe('Call mum');
    expect(items[1].snippet).toBeUndefined();
    expect(items[1].meta).toBeUndefined();
  });

  it('binds restore/delete-forever to the row id and passes empty-trash through', async () => {
    const el = await TrashPage();

    const restore = el.props.restoreAction('t1');
    expect(typeof restore).toBe('function');
    restore();
    expect(mockedRestore).toHaveBeenCalledWith('t1');

    const del = el.props.deleteForeverAction('t2');
    expect(typeof del).toBe('function');
    del();
    expect(mockedDeleteForever).toHaveBeenCalledWith('t2');

    expect(el.props.emptyTrashAction).toBe(mockedEmpty);
  });
});
