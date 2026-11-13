import { rmSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { ENC_PREFIX } from '@life/crypto';
import { OriginGrant, type Principal } from '@life/service-kit';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { TodosCache } from '../src/cache/todo-cache.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';

/**
 * The per-occurrence title snapshot: a rename freezes the title its already-done
 * occurrences were finished under, so a repeating task's history survives a target
 * change while its open occurrence takes the new number.
 *
 * Why this exists at all. A meal task is created `repeat: 'daily'`, and ticking one
 * does NOT set `done: true` — it logs a `todo_completion` for that occurrence and
 * advances `dueDate`, staying open (`SPEC-todo-origin` assumption 7). So
 * `renameByOrigin`'s `done` guard cannot see that yesterday was already completed,
 * and without a snapshot the rename rewrites the title the owner's Done row renders —
 * falsifying a record of what they did.
 *
 * The snapshot is written by the **rename**, never the tick. That is why a completion
 * logged after a rename carries no snapshot and correctly reads the live (new) title.
 *
 * Service-level over the real graph: real `TodosService`, real `@life/crypto`
 * envelopes, real sqlite. The assertion is on the served DTO, not on a private field.
 */

const PRODUCER_A = 'producer-a';
const GRANTED_ORIGIN = 'meal-service';
const OLD_TITLE = 'Eat Breakfast to reach 2200 kcal';
const NEW_TITLE = 'Eat Breakfast to reach 2500 kcal';

describe('Completion title snapshot (rename after tick)', () => {
  let h: UnitHarness;
  let dataSource: DataSource;

  beforeEach(async () => {
    h = await makeUnitHarness(new TodosCache(null));
    dataSource = h.dataSource;
    await dataSource.getRepository(OriginGrant).insert({
      ownerSub: SUB,
      clientId: PRODUCER_A,
      direction: 'write',
      originService: GRANTED_ORIGIN,
      grantedAt: new Date(),
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
    rmSync(h.dir, { recursive: true, force: true });
  });

  const producer = (): Principal => ({ sub: SUB, clientId: PRODUCER_A });

  /** A daily repeating origin task due `dueDate`, titled `title`. */
  const createRepeating = (originId: string, title: string, dueDate: string) =>
    h.todos.createWithOrigin(producer(), {
      title,
      originId,
      repeat: 'daily',
      dueDate,
    } as never);

  /** The completion log as the app reads it — the same call `/todos` makes. */
  const completions = async () => (await h.todos.findCompletions(SUB, {})).completions;

  it('freezes the old title on a done occurrence, and leaves the open occurrence at the new one', async () => {
    await createRepeating('meal:breakfast', OLD_TITLE, '2026-11-13');
    // Tick it: logs the 13th and advances, staying open — a repeating task's shape.
    await h.todos.completeByOrigin(producer(), 'meal:breakfast', {});

    await h.todos.renameByOrigin(producer(), 'meal:breakfast', { title: NEW_TITLE });

    const [live] = (await h.todos.findAll(SUB, {})).todos;
    // The OPEN occurrence names the number that applies now.
    expect(live.title).toBe(NEW_TITLE);
    expect(live.done).toBe(false);

    const [done] = await completions();
    // The DONE occurrence still names the number the owner ticked against.
    expect(done.title).toBe(OLD_TITLE);
    expect(done.occurrence).toBe('2026-11-13');
  });

  it('gives a completion logged AFTER the rename the new title, not the frozen one', async () => {
    await createRepeating('meal:lunch', OLD_TITLE, '2026-11-13');
    await h.todos.completeByOrigin(producer(), 'meal:lunch', {});
    await h.todos.renameByOrigin(producer(), 'meal:lunch', { title: NEW_TITLE });

    // The next day's tick happens at the NEW number, so it must not inherit a
    // snapshot: a NULL snapshot is the correct answer, and the read falls back.
    await h.todos.completeByOrigin(producer(), 'meal:lunch', {});

    const logged = await completions();
    expect(logged).toHaveLength(2);
    const byOccurrence = new Map(logged.map((row) => [row.occurrence, row.title]));
    // The 13th was ticked at the old number; the 14th at the new one.
    expect([...byOccurrence.values()].sort()).toEqual([NEW_TITLE, OLD_TITLE].sort());
    expect(byOccurrence.get('2026-11-13')).toBe(OLD_TITLE);
    expect(byOccurrence.get('2026-11-14')).toBe(NEW_TITLE);
  });

  it('stores the snapshot as an enc.v1. envelope, never plaintext', async () => {
    await createRepeating('meal:dinner', OLD_TITLE, '2026-11-13');
    await h.todos.completeByOrigin(producer(), 'meal:dinner', {});
    await h.todos.renameByOrigin(producer(), 'meal:dinner', { title: NEW_TITLE });

    const [row] = await dataSource.getRepository(TodoCompletion).find();
    expect(row.title).toBeDefined();
    expect(row.title!.startsWith(ENC_PREFIX)).toBe(true);
    expect(row.title).not.toContain('2200');
    expect(row.title).not.toContain('Breakfast');
  });

  it('never overwrites a snapshot a previous rename already froze', async () => {
    await createRepeating('meal:breakfast', OLD_TITLE, '2026-11-13');
    await h.todos.completeByOrigin(producer(), 'meal:breakfast', {});
    await h.todos.renameByOrigin(producer(), 'meal:breakfast', { title: NEW_TITLE });
    const frozen = (await dataSource.getRepository(TodoCompletion).find())[0].title;

    // A second target change must leave the history it already froze alone.
    await h.todos.renameByOrigin(producer(), 'meal:breakfast', {
      title: 'Eat Breakfast to reach 2600 kcal',
    });

    expect((await dataSource.getRepository(TodoCompletion).find())[0].title).toBe(frozen);
    expect((await completions())[0].title).toBe(OLD_TITLE);
    expect((await h.todos.findAll(SUB, {})).todos[0].title).toBe(
      'Eat Breakfast to reach 2600 kcal',
    );
  });
});
