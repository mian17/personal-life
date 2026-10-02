import { rmSync } from 'fs';
import {
  generationKey,
  TODO_COMPLETIONS,
  TodosCache,
  type CacheHitOptions,
} from '../src/cache/todo-cache';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness';
import { FakeRedisClient } from './fake-redis';

/**
 * `SPEC-todo-completion-history` Cache Rules (AGENTS.md Contract 2) for the
 * `GET /api/todos/completions` read: one cached entry under
 * `todo:<sub>:v<gen>:completions`, no `limit`/`cursor` in the key, per-write
 * generation invalidation, the loader only reached through `getThrough`, and a
 * corrupt hit failing open. Mirrors the `reminders.e2e-spec.ts` recording-cache
 * pattern; the DB is a throwaway sqlite file — never `apps/todo-service/data/**`.
 */

/** Records which `<rest>` keys a read-through call used and every bump. */
class RecordingTodosCache extends TodosCache {
  readonly calls: Array<{ sub: string; rest: string }> = [];
  readonly bumps: string[] = [];

  override async getThrough<T>(
    sub: string,
    rest: string,
    loader: () => Promise<T>,
    options?: CacheHitOptions<T>,
  ): Promise<T> {
    this.calls.push({ sub, rest });
    return super.getThrough(sub, rest, loader, options);
  }

  override async bumpGeneration(sub: string): Promise<void> {
    this.bumps.push(sub);
    return super.bumpGeneration(sub);
  }
}

describe('Completion log cache (read-through + generation invalidation)', () => {
  let h: UnitHarness;
  let client: FakeRedisClient;
  let cache: RecordingTodosCache;

  beforeEach(async () => {
    client = new FakeRedisClient();
    cache = new RecordingTodosCache(client);
    h = await makeUnitHarness(cache);
  });

  afterEach(async () => {
    if (h) {
      await h.dataSource.destroy();
      rmSync(h.dir, { recursive: true, force: true });
      h = undefined as unknown as UnitHarness;
    }
  });

  const currentGen = (): number =>
    Number.parseInt(client.store.get(generationKey(SUB)) ?? '0', 10) || 0;

  /** Count the loader queries the driver emitted for the completion table. */
  const loaderCalls = (): number =>
    h.log.filter((sql) => /from "todo_completion"/i.test(sql)).length;

  it('caches the log under todo:<sub>:v<gen>:completions; one entry serves every page variant', async () => {
    const t = await h.todos.create(SUB, { title: 'SECRET-TITLE', dueDate: '2026-10-02' });
    await h.todos.update(SUB, t.id, { done: true });
    const gen = currentGen();
    const key = `todo:${SUB}:v${gen}:completions`;
    h.log.length = 0;
    client.sets.length = 0;
    cache.calls.length = 0;

    await h.todos.findCompletions(SUB, {});
    const full = await h.todos.findCompletions(SUB, { limit: 5, cursor: 'x' });
    void full;

    expect(loaderCalls()).toBe(1);
    expect(client.setCalls).toContain(key);
    // The rest key is asserted through the recording cache override.
    expect(cache.calls).toContainEqual({ sub: SUB, rest: TODO_COMPLETIONS });
    // Rows-as-persisted: the log has no content column, so no plaintext title.
    const stored = client.store.get(key)!;
    expect(stored).toContain('"occurrence"');
    expect(stored).toContain('"completedAt"');
    expect(stored).not.toContain('SECRET-TITLE');
  });

  it('every read flows through getThrough; a hit skips the loader', async () => {
    const t = await h.todos.create(SUB, { title: 'hit', dueDate: '2026-10-02' });
    await h.todos.update(SUB, t.id, { done: true });

    await h.todos.findCompletions(SUB, {});
    expect(cache.calls.filter((c) => c.rest === TODO_COMPLETIONS)).toHaveLength(1);

    h.log.length = 0;
    await h.todos.findCompletions(SUB, {});
    expect(loaderCalls()).toBe(0);
  });

  it('a tick, a one-off Undo, and a permanent delete each bump the generation so the next read refetches', async () => {
    const t = await h.todos.create(SUB, { title: 'bumps', dueDate: '2026-10-02' });
    h.log.length = 0;
    await h.todos.findCompletions(SUB, {});
    expect(loaderCalls()).toBe(1);

    // Tick.
    cache.bumps.length = 0;
    await h.todos.update(SUB, t.id, { done: true });
    expect(cache.bumps).toContain(SUB);
    h.log.length = 0;
    await h.todos.findCompletions(SUB, {});
    expect(loaderCalls()).toBe(1);

    // One-off Undo.
    cache.bumps.length = 0;
    await h.todos.update(SUB, t.id, { done: false });
    expect(cache.bumps).toContain(SUB);
    h.log.length = 0;
    await h.todos.findCompletions(SUB, {});
    expect(loaderCalls()).toBe(1);

    // Permanent delete (after a soft delete).
    await h.todos.remove(SUB, t.id);
    cache.bumps.length = 0;
    await h.todos.removePermanent(SUB, t.id);
    expect(cache.bumps).toContain(SUB);
    h.log.length = 0;
    await h.todos.findCompletions(SUB, {});
    expect(loaderCalls()).toBe(1);
  });

  it('fails open when the hit is a non-array', async () => {
    const t = await h.todos.create(SUB, { title: 'corrupt', dueDate: '2026-10-02' });
    await h.todos.update(SUB, t.id, { done: true });
    const key = `todo:${SUB}:v${currentGen()}:completions`;
    client.store.set(key, JSON.stringify('not-an-array'));
    h.log.length = 0;

    const page = await h.todos.findCompletions(SUB, {});

    expect(page.completions).toHaveLength(1);
    expect(loaderCalls()).toBe(1);
  });

  it('fails open when a hit row has a non-string field', async () => {
    const t = await h.todos.create(SUB, { title: 'corrupt-row', dueDate: '2026-10-02' });
    await h.todos.update(SUB, t.id, { done: true });
    const key = `todo:${SUB}:v${currentGen()}:completions`;
    client.store.set(
      key,
      JSON.stringify([{ id: 'x', todoId: t.id, occurrence: '~', completedAt: 42 }]),
    );
    h.log.length = 0;

    const page = await h.todos.findCompletions(SUB, {});

    expect(page.completions).toHaveLength(1);
    expect(loaderCalls()).toBe(1);
  });
});
