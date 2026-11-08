/**
 * `softDeleteBatch` / `softDeleteOne` — the one soft-delete every trashable
 * meal-service resource shares.
 *
 * Foods, saved meals and entries trash a row the same way: find it scoped to its
 * owner and still live, answer `404` when it is not there, stamp `deletedAt`,
 * save. Two services differ in exactly two words — which repository the row
 * lives in, and what the `404` says — so those two are parameters here instead
 * of three near-identical bodies kept in step by hand. A change to the owner
 * predicate is a security change, and it must land once.
 *
 * The batch form adds nothing to the lifecycle: `runAtomicBatch` still owns the
 * size check, submission order, the single transaction, rollback by propagation
 * and the one post-commit bump (`batch-runner.ts`). This module supplies only
 * that batch's `runItem`, so a foreign or already-trashed id still aborts the
 * whole batch — leaving every row live — and a committed batch still bumps once.
 */
import { NotFoundException } from '@nestjs/common';
import type { ReadThroughCache } from '@life/cache';
import { IsNull, type DataSource, type EntityManager, type FindOperator } from 'typeorm';
import { runAtomicBatch } from '@life/service-kit';

/**
 * What a soft delete needs from a row: the identity it was asked for, the owner
 * it is scoped to, and the column it stamps. Nothing else, so the helpers below
 * are generic over any entity that carries these three.
 */
export interface TrashableRow {
  id: string;
  ownerSub: string | null;
  deletedAt: Date | null;
}

/**
 * The one live, owner-scoped read and the one write a soft delete makes. Stated
 * over the row shape alone so the helpers stay entity-generic;
 * `Repository<Food>`, `Repository<SavedMeal>` and `Repository<Entry>` satisfy it
 * as they are, with no cast.
 */
export interface TrashableRepository<Row extends TrashableRow> {
  findOne(options: {
    where: { id: string; ownerSub: string; deletedAt: FindOperator<Date> };
  }): Promise<Row | null>;
  save(row: Row): Promise<Row>;
}

/** A resource's rows: a manager means inside that transaction, no manager means the service's own repository. */
export type RepositoryFor<Row extends TrashableRow> = (
  manager: EntityManager | undefined,
) => TrashableRepository<Row>;

/** The two facts that differ per resource, named so a service states them once. */
export interface SoftDeleteTarget<Row extends TrashableRow> {
  repositoryFor: RepositoryFor<Row>;
  /** The singular `404` message, shared by the single and batch paths alike. */
  notFound: string;
}

/** One committed batch: the ids to trash plus the datasource and cache it commits through. */
export interface SoftDeleteBatchRequest {
  items: readonly { id: string }[];
  sub: string;
  dataSource: DataSource;
  cache: ReadThroughCache;
}

/**
 * Move one live row out of every read, through the manager the caller supplies,
 * and with no bump.
 *
 * Soft by definition — `deletedAt` is stamped, nothing is deleted — so the batch
 * means exactly what the singular route means: the row leaves every read while
 * the ids that reference it keep resolving.
 */
export async function softDeleteOne<Row extends TrashableRow>(
  { repositoryFor, notFound }: SoftDeleteTarget<Row>,
  manager: EntityManager | undefined,
  sub: string,
  id: string,
): Promise<void> {
  const rows = repositoryFor(manager);
  const row = await rows.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
  if (!row) throw new NotFoundException(notFound);
  row.deletedAt = new Date();
  await rows.save(row);
}

/**
 * The `batchDelete` shape: one transaction, submission order, one bump, and the
 * singular route's soft-delete meaning. A foreign id is a `404` that rolls the
 * whole batch back; the ids come back in submission order for per-item
 * confirmation, with no partial-success envelope.
 */
export async function softDeleteBatch<Row extends TrashableRow>(
  target: SoftDeleteTarget<Row>,
  { items, sub, dataSource, cache }: SoftDeleteBatchRequest,
): Promise<{ deleted: string[] }> {
  const deleted = await runAtomicBatch({
    items,
    sub,
    dataSource,
    cache,
    runItem: async (item, manager) => {
      await softDeleteOne(target, manager, sub, item.id);
      return item.id;
    },
  });
  return { deleted };
}
