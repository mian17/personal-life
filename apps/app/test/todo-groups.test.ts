import type { Todo, TodoCompletion } from '@life/shared';
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
    originService: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
  };
}

function completion(
  id: string,
  todoId: string,
  completedAt = '2026-10-02T10:00:00.000Z',
): TodoCompletion {
  return {
    id,
    todoId,
    occurrence: '2026-09-28',
    completedAt,
    title: id,
    listId: null,
    listName: null,
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

  it("makes an open repeating todo's latest completion a done Todo row in Done", () => {
    const repeating = todo('rep', '2026-10-05');
    const completions = [
      completion('c2', 'rep', '2026-10-02T10:00:00.000Z'),
      completion('c1', 'rep', '2026-10-01T10:00:00.000Z'),
    ];
    const done = groupTodos([repeating], TODAY, completions).find((g) => g.key === 'done')!;
    // One row per todo (the latest occurrence): the live row spread to a done
    // occurrence, so it renders through the same `TodoItem` as every Done row.
    expect(done.todos.map((t) => t.id)).toEqual(['rep']);
    expect(done.todos[0]).toMatchObject({
      id: 'rep',
      done: true,
      dueDate: '2026-09-28', // the satisfied occurrence, not the live next due
      version: 0, // the live version, so the row's un-tick stays version-checked
    });
  });

  it("skips a done todo's completion (its own struck row is already there)", () => {
    const grouped = groupTodos([todo('d', '2026-09-01', true)], TODAY, [completion('c1', 'd')]);
    const done = grouped.find((g) => g.key === 'done')!;
    expect(done.todos.map((t) => t.id)).toEqual(['d']);
  });

  it('ignores a completion with no matching live todo, and defaults to no completions', () => {
    const withStray = groupTodos([], TODAY, [completion('c1', 'gone')]).find(
      (g) => g.key === 'done',
    )!;
    expect(withStray.todos).toEqual([]);

    const noLog = groupTodos([todo('d', '2026-09-01', true)], TODAY).find((g) => g.key === 'done')!;
    expect(noLog.todos.map((t) => t.id)).toEqual(['d']);
  });

  it('orders Done by latest completion (tick) time, interleaving occurrences and one-offs', () => {
    const todos = [
      todo('one-off-old', '2026-09-01', true),
      todo('rep', '2026-10-05'),
      todo('one-off-new', '2026-09-02', true),
    ];
    const completions = [
      completion('c1', 'one-off-old', '2026-10-01T10:00:00.000Z'),
      completion('c2', 'rep', '2026-10-02T10:00:00.000Z'),
      completion('c3', 'one-off-new', '2026-10-03T10:00:00.000Z'),
    ];
    const done = groupTodos(todos, TODAY, completions).find((g) => g.key === 'done')!;
    expect(done.todos.map((t) => t.id)).toEqual(['one-off-new', 'rep', 'one-off-old']);
  });

  it('breaks equal tick-time ties by id DESC', () => {
    const at = '2026-10-02T10:00:00.000Z';
    const todos = [todo('a', null, true), todo('b', null, true)];
    const completions = [completion('c1', 'a', at), completion('c2', 'b', at)];
    const done = groupTodos(todos, TODAY, completions).find((g) => g.key === 'done')!;
    expect(done.todos.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('sinks Done rows with no logged completion below every timed row, in service order', () => {
    const todos = [
      todo('legacy-1', '2026-09-01', true),
      todo('legacy-2', '2026-09-02', true),
      todo('timed', '2026-09-03', true),
    ];
    const completions = [completion('c1', 'timed', '2026-10-02T10:00:00.000Z')];
    const done = groupTodos(todos, TODAY, completions).find((g) => g.key === 'done')!;
    expect(done.todos.map((t) => t.id)).toEqual(['timed', 'legacy-1', 'legacy-2']);
  });

  it('leaves Overdue and Today grouping and service order untouched by Done ordering', () => {
    const todos = [
      todo('overdue-2', '2026-09-01'),
      todo('today-1', '2026-09-28'),
      todo('overdue-1', '2026-09-02'),
      todo('done-1', null, true),
    ];
    const completions = [completion('c1', 'done-1', '2026-10-02T10:00:00.000Z')];
    const byKey = Object.fromEntries(
      groupTodos(todos, TODAY, completions).map((g) => [g.key, g.todos.map((t) => t.id)]),
    );
    expect(byKey).toEqual({
      overdue: ['overdue-2', 'overdue-1'],
      today: ['today-1'],
      done: ['done-1'],
    });
  });
});
