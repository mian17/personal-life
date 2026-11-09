import { randomUUID } from 'crypto';
import { rmSync } from 'fs';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';

/**
 * `SPEC-todo-completion-history` API `GET /api/todos/completions` at the service
 * level: ordering (`completedAt DESC, id DESC`), keyset-cursor continuity, the
 * `limit` default/cap, owner scoping, the active-todo join, and the decrypted
 * `title`/`listId`/`listName` assembly. Throwaway sqlite DB under the OS temp
 * dir — never `apps/todo-service/data/**`.
 */

describe('TodosService.findCompletions', () => {
  let h: UnitHarness;

  beforeEach(async () => {
    h = await makeUnitHarness();
  });

  afterEach(async () => {
    if (h) {
      await h.dataSource.destroy();
      rmSync(h.dir, { recursive: true, force: true });
      h = undefined as unknown as UnitHarness;
    }
  });

  const insert = (
    todoId: string,
    occurrence: string,
    completedAt: string,
    sub = SUB,
    id: string = randomUUID(),
  ) =>
    h.dataSource
      .getRepository(TodoCompletion)
      .insert({ id, ownerSub: sub, todoId, occurrence, completedAt });

  const ids = (page: { completions: Array<{ id: string }> }) => page.completions.map((c) => c.id);

  it('returns rows in completedAt DESC, id DESC order', async () => {
    const t = await h.todos.create(SUB, { title: 'order' });
    await insert(t.id, 'a', '2026-01-01T00:00:00.000Z', SUB, 'aaa');
    await insert(t.id, 'b', '2026-01-02T00:00:00.000Z', SUB, 'bbb');
    await insert(t.id, 'c', '2026-01-02T00:00:00.000Z', SUB, 'ccc');

    const page = await h.todos.findCompletions(SUB, {});

    expect(ids(page)).toEqual(['ccc', 'bbb', 'aaa']);
  });

  it('cursor continuity: paging yields every row with no duplicate and no skip', async () => {
    const t = await h.todos.create(SUB, { title: 'pages' });
    const all = ['r1', 'r2', 'r3', 'r4', 'r5'];
    for (let i = 0; i < all.length; i += 1) {
      await insert(t.id, `occ-${i}`, `2026-01-0${i + 1}T00:00:00.000Z`, SUB, all[i]);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await h.todos.findCompletions(SUB, { limit: 2, cursor });
      seen.push(...ids(page));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual([...all].reverse());
    expect(new Set(seen).size).toBe(all.length);
  });

  it('applies the limit default (50) and the 200 cap', async () => {
    const t = await h.todos.create(SUB, { title: 'many' });
    for (let i = 0; i < 205; i += 1) {
      await insert(
        t.id,
        `o${String(i).padStart(3, '0')}`,
        `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
        SUB,
        `id${String(i).padStart(3, '0')}`,
      );
    }

    const defaulted = await h.todos.findCompletions(SUB, {});
    expect(defaulted.completions).toHaveLength(50);
    expect(defaulted.nextCursor).not.toBeNull();

    const capped = await h.todos.findCompletions(SUB, { limit: 200 });
    expect(capped.completions).toHaveLength(200);
    expect(capped.nextCursor).not.toBeNull();
  });

  it("owner scoping: a foreign sub never sees another owner's rows", async () => {
    const mine = await h.todos.create(SUB, { title: 'mine' });
    await insert(mine.id, 'm', '2026-01-01T00:00:00.000Z', SUB, 'mine-row');

    const other = 'other-sub';
    const theirs = await h.todos.create(other, { title: 'theirs' });
    await insert(theirs.id, 't', '2026-01-02T00:00:00.000Z', other, 'their-row');

    expect(ids(await h.todos.findCompletions(SUB, {}))).toEqual(['mine-row']);
    expect(ids(await h.todos.findCompletions(other, {}))).toEqual(['their-row']);
  });

  it("omits a trashed todo's completions from the page", async () => {
    const t = await h.todos.create(SUB, { title: 'trashed', dueDate: '2026-10-02' });
    await h.todos.update(SUB, t.id, { done: true });
    expect((await h.todos.findCompletions(SUB, {})).completions).toHaveLength(1);

    await h.todos.remove(SUB, t.id);

    expect((await h.todos.findCompletions(SUB, {})).completions).toHaveLength(0);
  });

  it('decrypts title and resolves listId/listName for a listed todo, null for an unlisted one', async () => {
    const l = await h.lists.create(SUB, 'Groceries');
    const listed = await h.todos.create(SUB, {
      title: 'listed title',
      dueDate: '2026-10-02',
      listId: l.id,
    });
    await h.todos.update(SUB, listed.id, { done: true });

    const unlisted = await h.todos.create(SUB, { title: 'unlisted title' });
    await h.todos.update(SUB, unlisted.id, { done: true });

    const { completions } = await h.todos.findCompletions(SUB, {});
    const byTodo = new Map(completions.map((c) => [c.todoId, c]));

    expect(byTodo.get(listed.id)).toMatchObject({
      title: 'listed title',
      listId: l.id,
      listName: 'Groceries',
    });
    expect(byTodo.get(unlisted.id)).toMatchObject({
      title: 'unlisted title',
      listId: null,
      listName: null,
    });
  });
});
