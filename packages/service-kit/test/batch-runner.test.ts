import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { ReadThroughCache } from '@life/cache';
import {
  MAX_BATCH_ITEMS,
  assertBatchSize,
  runAtomicBatch,
  runInSubmissionOrder,
} from '../src/index';

const fakeManager = { name: 'fake-manager' } as unknown as EntityManager;

/**
 * A datasource whose transaction runs the callback against the fake manager and
 * counts how often it was opened — the whole point of the cap tests.
 */
function createDataSource() {
  const transaction = jest.fn(
    async (work: (manager: EntityManager) => Promise<unknown>) => work(fakeManager),
  );
  return { dataSource: { transaction } as unknown as DataSource, transaction };
}

/** A cache that records each bump, and the order of bumps and commits. */
function createCache(commitLog: string[] = []) {
  const bumpGeneration = jest.fn(async (sub: string) => {
    commitLog.push(`bump:${sub}`);
  });
  return {
    cache: { bumpGeneration } as unknown as ReadThroughCache,
    bumpGeneration,
  };
}

function createDataSourceLoggingCommits(commitLog: string[]) {
  const transaction = jest.fn(
    async (work: (manager: EntityManager) => Promise<unknown>) => {
      const result = await work(fakeManager);
      commitLog.push('commit');
      return result;
    },
  );
  return { dataSource: { transaction } as unknown as DataSource, transaction };
}

const range = (length: number) => Array.from({ length }, (_, index) => index);

describe('batch limits', () => {
  it('caps a batch at ten items', () => {
    expect(MAX_BATCH_ITEMS).toBe(10);
  });

  it('accepts a batch of one and a batch of ten', () => {
    expect(() => assertBatchSize(range(1))).not.toThrow();
    expect(() => assertBatchSize(range(MAX_BATCH_ITEMS))).not.toThrow();
  });

  it.each([0, MAX_BATCH_ITEMS + 1])(
    'rejects a batch of %i items with a 400 naming the cap',
    (count) => {
      expect(() => assertBatchSize(range(count))).toThrow(BadRequestException);
      expect(() => assertBatchSize(range(count))).toThrow(
        new RegExp(String(MAX_BATCH_ITEMS)),
      );
    },
  );

  it.each([0, MAX_BATCH_ITEMS + 1])(
    'never opens a transaction for a %i-item batch',
    async (count) => {
      const { dataSource, transaction } = createDataSource();
      const { cache } = createCache();

      await expect(
        runAtomicBatch({
          items: range(count),
          dataSource,
          sub: 'owner',
          runItem: async () => 'written',
          cache,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

describe('runInSubmissionOrder', () => {
  it('runs every item one after another, so a shared log reads in submission order', async () => {
    const log: number[] = [];

    const results = await runInSubmissionOrder(range(2), async (item) => {
      log.push(item);
      return item * 2;
    });

    expect(log).toEqual([0, 1]);
    expect(results).toEqual([0, 2]);
  });
});

describe('runAtomicBatch', () => {
  it('runs a ten-item batch in exactly one transaction and bumps once', async () => {
    const { dataSource, transaction } = createDataSource();
    const { cache, bumpGeneration } = createCache();

    const results = await runAtomicBatch({
      items: range(MAX_BATCH_ITEMS),
      dataSource,
      sub: 'owner',
      runItem: async (item) => `result-${item}`,
      cache,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(bumpGeneration).toHaveBeenCalledTimes(1);
    expect(bumpGeneration).toHaveBeenCalledWith('owner');
    expect(results).toEqual(range(MAX_BATCH_ITEMS).map((item) => `result-${item}`));
  });

  it('passes the transaction manager to every item', async () => {
    const { dataSource } = createDataSource();
    const { cache } = createCache();
    const managersSeen: EntityManager[] = [];

    await runAtomicBatch({
      items: range(2),
      dataSource,
      sub: 'owner',
      runItem: async (_item, manager) => managersSeen.push(manager),
      cache,
    });

    expect(managersSeen).toEqual([fakeManager, fakeManager]);
  });

  it('bumps once after the transaction commits, never before', async () => {
    const commitLog: string[] = [];
    const { dataSource } = createDataSourceLoggingCommits(commitLog);
    const { cache } = createCache(commitLog);

    await runAtomicBatch({
      items: range(2),
      dataSource,
      sub: 'owner',
      runItem: async () => 'written',
      cache,
    });

    expect(commitLog).toEqual(['commit', 'bump:owner']);
  });

  it.each([
    new NotFoundException('missing'),
    new ConflictException('stale'),
    new BadRequestException('malformed'),
  ])('propagates %p untouched and bumps nothing', async (error) => {
    const { dataSource } = createDataSource();
    const { cache, bumpGeneration } = createCache();
    const run = runAtomicBatch({
      items: range(3),
      dataSource,
      sub: 'owner',
      runItem: async (item) => {
        if (item === 1) throw error;
        return 'written';
      },
      cache,
    });

    await expect(run).rejects.toBe(error);
    expect(bumpGeneration).not.toHaveBeenCalled();
  });

  it('skips the bump when the caller reports nothing was written', async () => {
    const { dataSource } = createDataSource();
    const { cache, bumpGeneration } = createCache();

    const results = await runAtomicBatch({
      items: range(2),
      dataSource,
      sub: 'owner',
      runItem: async () => ({ created: false }),
      cache,
      invalidate: (batchResults) => batchResults.some((result) => result.created),
    });

    expect(results).toEqual([{ created: false }, { created: false }]);
    expect(bumpGeneration).not.toHaveBeenCalled();
  });

  it('bumps once when the caller reports a write happened', async () => {
    const { dataSource } = createDataSource();
    const { cache, bumpGeneration } = createCache();

    await runAtomicBatch({
      items: range(2),
      dataSource,
      sub: 'owner',
      runItem: async (item) => ({ created: item === 1 }),
      cache,
      invalidate: (batchResults) => batchResults.some((result) => result.created),
    });

    expect(bumpGeneration).toHaveBeenCalledTimes(1);
  });

  it('never consults the invalidation predicate before the transaction commits', async () => {
    const { dataSource } = createDataSource();
    const { cache } = createCache();
    const invalidate = jest.fn(() => true);

    await expect(
      runAtomicBatch({
        items: range(2),
        dataSource,
        sub: 'owner',
        runItem: async () => {
          throw new ConflictException('stale');
        },
        cache,
        invalidate,
      }),
    ).rejects.toThrow(ConflictException);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
