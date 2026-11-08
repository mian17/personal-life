/**
 * `runAtomicBatch` — the one batch kernel every service shares
 * (`SPEC-batch-receiver.md` §5).
 *
 * It owns the whole lifecycle of a batch: the size check, submission order, the
 * single transaction, rollback by propagation, and the single post-commit cache
 * bump. A service supplies only `runItem`, which does that service's existing
 * singular write through the transaction's manager, so no service repeats the
 * loop or opens a transaction of its own — a nested one would break atomicity.
 *
 * Generic by construction: no resource name, no entity and no delete concept
 * appears here. What a batch *means* per resource stays in that service.
 */
import type { DataSource, EntityManager } from 'typeorm';
import type { ReadThroughCache } from '@life/cache';
import { assertBatchSize } from './batch-limits';
import { runInSubmissionOrder } from './batch-item';

export interface BatchRun<Item, Result> {
  /** The batch, in submission order; the DTO layer has validated its shape only. */
  items: readonly Item[];
  /** The datasource the batch's one transaction runs on. */
  dataSource: DataSource;
  /** The owner every item is scoped to; also the key of the cache counter. */
  sub: string;
  /**
   * One item's work, run through the transaction's manager. Throwing aborts the
   * batch: the error propagates untouched and nothing commits.
   */
  runItem(item: Item, manager: EntityManager): Promise<Result>;
  /** The service's existing read-through cache; one bump covers its whole read set. */
  cache: ReadThroughCache;
  /**
   * Whether the committed batch invalidates the owner's cache at all. Defaults
   * to always. A create-or-get batch passes a predicate, because a batch that
   * wrote nothing must not bump (`SPEC-batch-receiver.md` §5.4).
   *
   * Consulted only after the transaction commits, never before: a batch that
   * rolls back cannot reach it.
   */
  invalidate?(results: readonly Result[]): boolean;
}

/**
 * Run `items` as one all-or-nothing transaction, then invalidate once.
 *
 * An out-of-range count is rejected before the transaction opens, so it never
 * reaches the database. An item's exception rolls the transaction back and
 * propagates unchanged, so the cache keeps serving a consistent view of a write
 * that did not happen.
 */
export async function runAtomicBatch<Item, Result>({
  items,
  dataSource,
  sub,
  runItem,
  cache,
  invalidate = () => true,
}: BatchRun<Item, Result>): Promise<Result[]> {
  assertBatchSize(items);

  const results = await dataSource.transaction((manager) =>
    runInSubmissionOrder(items, (item) => runItem(item, manager)),
  );

  if (invalidate(results)) {
    await cache.bumpGeneration(sub);
  }

  return results;
}
