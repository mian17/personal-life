import type { Todo } from '@life/shared';
import { collectTodos, dueStateOf } from '@/lib/todo-query';

function todo(id: string, dueDate: string | null): Todo {
  return {
    id,
    title: id,
    note: null,
    done: false,
    dueDate,
    listId: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
  };
}

describe('collectTodos', () => {
  it('follows the cursor until the service has no more pages', async () => {
    const pages: Record<string, { todos: Todo[]; nextCursor: string | null }> = {
      '': { todos: [todo('one', null)], nextCursor: 'p2' },
      p2: { todos: [todo('two', null)], nextCursor: null },
    };
    const seen: Array<string | undefined> = [];
    const all = await collectTodos(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? ''];
    });
    expect(seen).toEqual([undefined, 'p2']);
    expect(all.map((t) => t.id)).toEqual(['one', 'two']);
  });

  it('stops at maxItems even when the service offers more', async () => {
    const all = await collectTodos(
      async (cursor) =>
        cursor
          ? { todos: [], nextCursor: null }
          : { todos: [todo('one', null)], nextCursor: 'p2' },
      1,
    );
    expect(all).toHaveLength(1);
  });

  it('returns an empty set when the first page is empty', async () => {
    expect(await collectTodos(async () => ({ todos: [], nextCursor: null }))).toEqual([]);
  });
});

describe('dueStateOf', () => {
  it('delegates to DueDatePill so grouping and display cannot drift', () => {
    expect(dueStateOf(todo('a', '2026-09-27'), '2026-09-28')).toBe('overdue');
    expect(dueStateOf(todo('b', '2026-09-28'), '2026-09-28')).toBe('today');
    expect(dueStateOf(todo('c', '2026-09-29'), '2026-09-28')).toBe('later');
    expect(dueStateOf(todo('d', null), '2026-09-28')).toBe('none');
  });
});
