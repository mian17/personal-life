import { jest } from '@jest/globals';
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'fs';
import { EntityManager, QueryFailedError } from 'typeorm';
import { OriginGrant, type Principal } from '@life/service-kit';
import { Todo } from '../src/todos/todo.entity.js';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { generationKey, TodosCache, type CacheHitOptions } from '../src/cache/todo-cache.js';
import { makeUnitHarness, SUB, type UnitHarness } from './todo-harness.js';
import { FakeRedisClient } from './fake-redis.js';

/**
 * `SPEC-todo-origin` §5 + §11, and the plan's Task 6 acceptance criteria, at the
 * service seam: the two origin paths swallow the UNIQUE violation **and nothing
 * else**, and a write that happens bumps the owner's generation exactly once
 * while the swallowed no-op bumps nothing.
 *
 * The non-UNIQUE arm cannot be reached over HTTP — no request makes the driver
 * fail for another reason — so the manager's repositories are wrapped to reject
 * with a chosen error and the guard's decision is observed directly.
 */

const GRANTED = 'meal-service';
/** A second owner's grant for the same producer client — a different origin. */
const OTHER_GRANTED = 'calendar-service';
const OTHER_USER = 'user-b';

/** Records every read-through call and every generation bump. */
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

const principalOf = (): Principal => ({ sub: SUB, clientId: 'producer-a' });

/** A second owner: a different verified `sub`, the same producer client. */
const otherOwner = (): Principal => ({ sub: OTHER_USER, clientId: 'producer-a' });

const uniqueViolation = () =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    }),
  );

const otherFailure = () =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
    }),
  );

/** Every write the entity manager performs rejects with the chosen driver error. */
const rejectAllWrites = (failure: Error) => {
  jest.spyOn(EntityManager.prototype, 'insert').mockRejectedValue(failure as never);
  jest.spyOn(EntityManager.prototype, 'save').mockRejectedValue(failure as never);
};

describe('Origin write guards (service seam)', () => {
  let h: UnitHarness;
  let client: FakeRedisClient;
  let cache: RecordingTodosCache;

  beforeEach(async () => {
    client = new FakeRedisClient();
    cache = new RecordingTodosCache(client);
    h = await makeUnitHarness(cache);
    // A grant is per owner: this owner granted producer-a `meal-service`, and a
    // second owner granted the same client `calendar-service`.
    await h.dataSource.getRepository(OriginGrant).insert([
      { ownerSub: SUB, clientId: 'producer-a', originService: GRANTED, grantedAt: new Date() },
      {
        ownerSub: OTHER_USER,
        clientId: 'producer-a',
        originService: OTHER_GRANTED,
        grantedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (h) {
      await h.dataSource.destroy();
      rmSync(h.dir, { recursive: true, force: true });
      h = undefined as unknown as UnitHarness;
    }
  });

  const currentGen = (): number =>
    Number.parseInt(client.store.get(generationKey(SUB)) ?? '0', 10) || 0;

  const originedTodo = async (originId: string, dueDate: string | null = null): Promise<Todo> => {
    await h.todos.createWithOrigin(principalOf(), { title: 'prep', originId, dueDate });
    const [row] = await h.dataSource.getRepository(Todo).find({ where: { originId } });
    return row;
  };

  describe('the completion insert swallows only the UNIQUE violation', () => {
    it('propagates any other driver error instead of answering idempotently', async () => {
      await originedTodo('guard-complete-1');
      rejectAllWrites(otherFailure());

      await expect(h.todos.completeByOrigin(principalOf(), 'guard-complete-1')).rejects.toThrow(
        'database is locked',
      );
    });

    it('still swallows the UNIQUE violation itself', async () => {
      await originedTodo('guard-complete-2');
      rejectAllWrites(uniqueViolation());

      // The repeat answers the pre-write state; no throw, no second row.
      const view = await h.todos.completeByOrigin(principalOf(), 'guard-complete-2');

      expect(view.originId).toBe('guard-complete-2');
      expect(
        await h.dataSource.getRepository(TodoCompletion).count({ where: { todoId: view.id } }),
      ).toBe(0);
    });
  });

  describe('the create insert swallows only the UNIQUE violation', () => {
    it('propagates any other driver error instead of answering 409', async () => {
      rejectAllWrites(otherFailure());

      await expect(
        h.todos.createWithOrigin(principalOf(), { title: 'prep', originId: 'guard-create-1' }),
      ).rejects.toThrow('database is locked');
    });
  });

  describe('the origin lookup is owner-scoped', () => {
    it("stamps each owner's own granted origin for the same producer client", async () => {
      const mine = await originedTodo('guard-scope-1');
      await h.todos.createWithOrigin(otherOwner(), { title: 'prep', originId: 'guard-scope-1' });
      const theirs = await h.dataSource
        .getRepository(Todo)
        .findOneByOrFail({ ownerSub: OTHER_USER, originId: 'guard-scope-1' });

      expect(mine.originService).toBe(GRANTED);
      expect(theirs.originService).toBe(OTHER_GRANTED);
    });

    it("answers another owner's origin id with the same 404 a nonexistent id gets", async () => {
      const todo = await originedTodo('guard-oracle-1');

      const foreign = await h.todos
        .completeByOrigin(otherOwner(), 'guard-oracle-1')
        .catch((err: unknown) => err);
      const missing = await h.todos
        .completeByOrigin(otherOwner(), 'guard-never-existed')
        .catch((err: unknown) => err);

      expect(foreign).toBeInstanceOf(NotFoundException);
      expect((foreign as NotFoundException).getStatus()).toBe(404);
      expect((missing as NotFoundException).getStatus()).toBe(404);
      expect(
        await h.dataSource.getRepository(TodoCompletion).count({ where: { todoId: todo.id } }),
      ).toBe(0);
    });
  });

  describe('the generation counter', () => {
    it('bumps exactly once for a write that happened', async () => {
      await originedTodo('gen-create-1');
      expect(cache.bumps).toEqual([SUB]);
      expect(currentGen()).toBe(1);
    });

    it('bumps nothing for a repeated origin id', async () => {
      await originedTodo('gen-create-2');
      cache.bumps.length = 0;

      await expect(
        h.todos.createWithOrigin(principalOf(), { title: 'again', originId: 'gen-create-2' }),
      ).rejects.toThrow('already used');

      expect(cache.bumps).toEqual([]);
      expect(currentGen()).toBe(1);
    });

    it('bumps once for the first completion and not for the repeat', async () => {
      await originedTodo('gen-complete-1');
      cache.bumps.length = 0;

      await h.todos.completeByOrigin(principalOf(), 'gen-complete-1');
      expect(cache.bumps).toEqual([SUB]);

      cache.bumps.length = 0;
      await h.todos.completeByOrigin(principalOf(), 'gen-complete-1');
      expect(cache.bumps).toEqual([]);
      expect(currentGen()).toBe(2);
    });
  });
});
