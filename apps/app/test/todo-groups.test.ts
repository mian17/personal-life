import type { Todo } from '@life/shared';
import { groupTodos, TODO_GROUPS } from '@/lib/todo-groups';
import { dueStateOf } from '@/lib/todo-query';

const TODAY = '2026-09-28';

function todo(id: string, dueDate: string | null, done = false): Todo {
  return {
    id,
    title: id,
    note: null,
    done,
    important: null,
    effectiveImportant: false,
    dueDate,
    repeat: null,
    repeatDays: null,
    reminderScheduledAt: null,
    listId: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
  };
}

describe('groupTodos', () => {
  it('always returns the three groups in spec order', () => {
    expect(TODO_GROUPS.map((g) => g.label)).toEqual(['Overdue', 'Today', 'Done']);
  });

  it('buckets open todos by the DueDatePill state derivation and hides later/none', () => {
    const todos = [
      todo('overdue-1', '2026-09-01'),
      todo('today-1', '2026-09-28'),
      todo('later-1', '2026-10-05'),
      todo('none-1', null),
      todo('overdue-2', '2026-09-27'),
    ];
    const grouped = groupTodos(todos, TODAY);
    const byKey = Object.fromEntries(grouped.map((g) => [g.key, g.todos.map((t) => t.id)]));
    expect(byKey).toEqual({
      overdue: ['overdue-1', 'overdue-2'],
      today: ['today-1'],
      done: [],
    });
  });

  it('done wins: a done todo lands in Done regardless of due date', () => {
    const todos = [
      todo('done-overdue', '2026-09-01', true),
      todo('done-later', '2026-10-05', true),
      todo('done-undated', null, true),
      todo('open-today', '2026-09-28'),
    ];
    const grouped = groupTodos(todos, TODAY);
    const byKey = Object.fromEntries(grouped.map((g) => [g.key, g.todos.map((t) => t.id)]));
    expect(byKey).toEqual({
      overdue: [],
      today: ['open-today'],
      done: ['done-overdue', 'done-later', 'done-undated'],
    });
  });

  it('preserves service order within a group', () => {
    const todos = [todo('a', '2026-09-05'), todo('b', '2026-09-01'), todo('c', '2026-09-09')];
    const overdue = groupTodos(todos, TODAY).find((g) => g.key === 'overdue')!;
    expect(overdue.todos.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty buckets for an empty list', () => {
    const grouped = groupTodos([], TODAY);
    expect(grouped).toHaveLength(3);
    expect(grouped.every((g) => g.todos.length === 0)).toBe(true);
  });

  it('agrees with dueDateState on every open bucket', () => {
    const todos = [todo('x', '2026-09-27'), todo('y', '2026-09-28')];
    for (const group of groupTodos(todos, TODAY)) {
      for (const item of group.todos) {
        if (group.key === 'done') continue;
        expect(dueStateOf(item, TODAY)).toBe(group.key);
      }
    }
  });
});
