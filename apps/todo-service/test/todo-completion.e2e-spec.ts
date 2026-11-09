import { ConflictException } from '@nestjs/common';
import { rmSync } from 'fs';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { dueSortKey, localToUtc, reminderLocal } from '../src/todos/due-time.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';

/**
 * `SPEC-todo-completion-history` Completion rules (C2/C3/C4/C7) at the service
 * level: the three tick/undo paths, the idempotent guarded insert, the OCC
 * rejection, and the delete lifecycle. Driven through `makeUnitHarness` — a real
 * throwaway sqlite file under the OS temp dir, never `apps/todo-service/data/**`.
 */

const TZ = 'Asia/Ho_Chi_Minh';

describe('Todo completion log (tick/undo rules)', () => {
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

  /** Query the log directly through the harness `dataSource`. */
  const rows = (todoId: string) =>
    h.dataSource
      .getRepository(TodoCompletion)
      .find({ where: { todoId }, order: { occurrence: 'ASC' } });

  /** The reminder instant the service recomputes for a date-only/ timed due. */
  const reminderAt = (due: string) =>
    localToUtc(reminderLocal(dueSortKey(due, TZ)), TZ).toISOString();

  /** The service TZ's calendar date `offsetDays` from now. */
  const localDay = (offsetDays: number) =>
    dueSortKey(new Date(Date.now() + offsetDays * 86_400_000).toISOString(), TZ).slice(0, 10);

  it('repeating tick appends the pre-advance due, advances the due, re-arms the reminder, keeps done false', async () => {
    const created = await h.todos.create(SUB, {
      title: 'repeat me',
      dueDate: '2020-01-01',
      repeat: 'daily',
    });

    const updated = await h.todos.update(SUB, created.id, { done: true });

    const log = await rows(created.id);
    expect(log).toHaveLength(1);
    // The occurrence is the PRE-advance due, in its stored dual shape.
    expect(log[0].occurrence).toBe('2020-01-01');
    expect(updated.done).toBe(false);
    expect(updated.dueDate).not.toBe('2020-01-01');
    expect(updated.dueDate! >= dueSortKey(new Date().toISOString(), TZ)).toBe(true);
    // The reminder is re-armed for the advanced due.
    expect(updated.reminderScheduledAt).toBe(reminderAt(updated.dueDate!));
  });

  it('a future-dated repeating tick advances strictly past the ticked occurrence', async () => {
    const tomorrow = localDay(1);
    const created = await h.todos.create(SUB, {
      title: 'tomorrow repeat',
      dueDate: tomorrow,
      repeat: 'daily',
    });

    const first = await h.todos.update(SUB, created.id, { done: true });

    const afterFirst = await rows(created.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].occurrence).toBe(tomorrow);
    expect(first.done).toBe(false);
    // Strictly past the just-completed occurrence, never jammed on it.
    expect(first.dueDate).toBe(localDay(2));

    const second = await h.todos.update(SUB, created.id, { done: true });

    const afterSecond = await rows(created.id);
    expect(afterSecond).toHaveLength(2);
    expect(new Set(afterSecond.map((r) => r.occurrence))).toEqual(
      new Set([localDay(1), localDay(2)]),
    );
    expect(second.dueDate).toBe(localDay(3));
    expect(second.done).toBe(false);
  });

  it('repeat tick undo deletes that occurrence row, restores the due and re-arms the reminder', async () => {
    const tomorrow = localDay(1);
    const created = await h.todos.create(SUB, {
      title: 'repeat undo',
      dueDate: tomorrow,
      repeat: 'daily',
    });

    const ticked = await h.todos.update(SUB, created.id, { done: true });
    expect(ticked.dueDate).toBe(localDay(2));
    expect((await rows(created.id)).map((r) => r.occurrence)).toEqual([tomorrow]);

    const undone = await h.todos.update(SUB, created.id, { done: false });

    expect(await rows(created.id)).toHaveLength(0);
    expect(undone.dueDate).toBe(tomorrow);
    expect(undone.reminderScheduledAt).toBe(reminderAt(tomorrow));
    expect(undone.done).toBe(false);
  });

  it('repeat tick undo with no completion row leaves the due unchanged', async () => {
    const tomorrow = localDay(1);
    const created = await h.todos.create(SUB, {
      title: 'repeat undo no-op',
      dueDate: tomorrow,
      repeat: 'daily',
    });
    const originalReminder = created.reminderScheduledAt;

    const undone = await h.todos.update(SUB, created.id, { done: false });

    expect(undone.dueDate).toBe(tomorrow);
    expect(undone.reminderScheduledAt).toBe(originalReminder);
    expect(undone.done).toBe(false);
    expect(await rows(created.id)).toHaveLength(0);
  });

  it('one-off tick appends occurrence = dueDate and closes the todo', async () => {
    const created = await h.todos.create(SUB, { title: 'one-off', dueDate: '2026-10-02' });

    const updated = await h.todos.update(SUB, created.id, { done: true });

    const log = await rows(created.id);
    expect(log).toHaveLength(1);
    expect(log[0].occurrence).toBe('2026-10-02');
    expect(updated.done).toBe(true);

    const undone = await h.todos.update(SUB, created.id, { done: false });

    // The unified rule deletes the newest row and restores its occurrence.
    expect(await rows(created.id)).toHaveLength(0);
    expect(undone.done).toBe(false);
    expect(undone.dueDate).toBe('2026-10-02');
  });

  it('undo after the due is edited deletes the newest recorded occurrence and reverts the due to it', async () => {
    const created = await h.todos.create(SUB, {
      title: 'edited after tick',
      dueDate: '2026-10-02',
    });
    await h.todos.update(SUB, created.id, { done: true });
    // Editing the due after the tick: the old occurrence-scoped rule matched
    // nothing here; the unified rule deletes the newest row whatever it recorded.
    await h.todos.update(SUB, created.id, { dueDate: '2026-11-01' });

    const undone = await h.todos.update(SUB, created.id, { done: false });

    expect(await rows(created.id)).toHaveLength(0);
    expect(undone.done).toBe(false);
    // The due reverts from the edit to the originally completed occurrence.
    expect(undone.dueDate).toBe('2026-10-02');
    expect(undone.reminderScheduledAt).toBe(reminderAt('2026-10-02'));
  });

  it("due-less one-off records occurrence '~' and its Undo deletes that row", async () => {
    const created = await h.todos.create(SUB, { title: 'someday' });

    const ticked = await h.todos.update(SUB, created.id, { done: true });
    expect(ticked.done).toBe(true);
    expect((await rows(created.id)).map((r) => r.occurrence)).toEqual(['~']);

    const undone = await h.todos.update(SUB, created.id, { done: false });
    expect(undone.done).toBe(false);
    expect(await rows(created.id)).toHaveLength(0);
  });

  it('retains earlier rows when a repeat-cleared todo is ticked as a one-off then undone', async () => {
    const created = await h.todos.create(SUB, {
      title: 'history',
      dueDate: '2020-01-01',
      repeat: 'daily',
    });

    // Build genuine history: each repeating tick logs its pre-advance due.
    for (const backdated of ['2020-01-01', '2020-01-05', '2020-01-10']) {
      if (backdated !== created.dueDate) {
        await h.todos.update(SUB, created.id, { dueDate: backdated });
      }
      await h.todos.update(SUB, created.id, { done: true });
    }
    const before = (await rows(created.id)).map((r) => r.occurrence);
    expect(before).toEqual(['2020-01-01', '2020-01-05', '2020-01-10']);

    // Clear the repeat and tick as a one-off on a distinct due, then undo it.
    await h.todos.update(SUB, created.id, { dueDate: '2020-02-01', repeat: null });
    await h.todos.update(SUB, created.id, { done: true });
    const undone = await h.todos.update(SUB, created.id, { done: false });

    // The unified rule deletes the NEWEST row (the one-off's 2020-02-01) and
    // restores that row's recorded occurrence as the due; earlier rows survive.
    const log = await rows(created.id);
    expect(log.map((r) => r.occurrence)).toEqual(before);
    expect(log.some((r) => r.occurrence === '2020-02-01')).toBe(false);
    expect(undone.dueDate).toBe('2020-02-01');
    expect(undone.done).toBe(false);
  });

  it('a double tick is a no-op insert (one row; the UNIQUE guard)', async () => {
    const created = await h.todos.create(SUB, { title: 'twice', dueDate: '2026-10-02' });

    await h.todos.update(SUB, created.id, { done: true });
    await h.todos.update(SUB, created.id, { done: true });

    expect(await rows(created.id)).toHaveLength(1);
  });

  it('a stale expectedVersion retry is 409 and never appends a row', async () => {
    const created = await h.todos.create(SUB, { title: 'occ', dueDate: '2026-10-02' });

    await expect(
      h.todos.update(SUB, created.id, { done: true, expectedVersion: 5 }),
    ).rejects.toThrow(ConflictException);
    expect(await rows(created.id)).toHaveLength(0);

    await h.todos.update(SUB, created.id, { done: true }); // version -> 1
    await expect(
      h.todos.update(SUB, created.id, { done: false, expectedVersion: 0 }),
    ).rejects.toThrow(ConflictException);
    // The 409 path leaves the successful occurrence intact.
    expect(await rows(created.id)).toHaveLength(1);
  });

  it('removePermanent and emptyTrash cascade-delete the completion rows', async () => {
    const a = await h.todos.create(SUB, { title: 'a', dueDate: '2026-10-02' });
    const b = await h.todos.create(SUB, { title: 'b', dueDate: '2026-10-02' });
    await h.todos.update(SUB, a.id, { done: true });
    await h.todos.update(SUB, b.id, { done: true });
    await h.todos.remove(SUB, a.id);
    await h.todos.remove(SUB, b.id);

    await h.todos.removePermanent(SUB, a.id);
    expect(await rows(a.id)).toHaveLength(0);
    expect(await rows(b.id)).toHaveLength(1);

    await h.todos.emptyTrash(SUB);
    expect(await rows(b.id)).toHaveLength(0);
  });

  it('soft delete leaves the rows; restore makes them visible again', async () => {
    const created = await h.todos.create(SUB, { title: 'restore', dueDate: '2026-10-02' });
    await h.todos.update(SUB, created.id, { done: true });
    expect((await h.todos.findCompletions(SUB, {})).completions).toHaveLength(1);

    await h.todos.remove(SUB, created.id);
    // The log survives trash (history is preserved) but is hidden from the page.
    expect(await rows(created.id)).toHaveLength(1);
    expect((await h.todos.findCompletions(SUB, {})).completions).toHaveLength(0);

    await h.todos.restore(SUB, created.id);
    expect((await h.todos.findCompletions(SUB, {})).completions).toHaveLength(1);
  });
});
