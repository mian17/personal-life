import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, type QueryDeepPartialEntity } from 'typeorm';
import { oneLine } from './outbox-poller.service.js';
import { Outbox } from './outbox.entity.js';

/** What a caller must state to owe one delivery. The id and clock are not its business. */
export interface OutboxEntry {
  ownerSub: string;
  /** Logical target, e.g. `todos.create`. */
  destination: string;
  /** The JSON body, already serialized — this seam never re-shapes a payload. */
  payload: string;
}

/**
 * One pending intent as the drain route serves it: the delivery identity, where it
 * goes, and the body to send. Deliberately no `ownerSub` (the caller *is* the owner)
 * and no retry state (that is this table's business, not the deliverer's).
 */
export interface PendingIntent {
  id: string;
  destination: string;
  payload: string;
}

/**
 * What became of one row, reported back after the caller attempted delivery.
 *
 * `published: true` closes the row. `published: false` keeps it pending and records
 * why, so a row that keeps failing is diagnosable later instead of silently stuck.
 */
export interface OutboxOutcome {
  id: string;
  published: boolean;
  /** Required in spirit when `published` is false; absent records no reason. */
  lastError?: string;
}

/**
 * The writer half of the outbox (`docs/roadmap/research/outbox-atomicity.md` §1).
 *
 * `enqueue` takes an `EntityManager` **explicitly and by requirement**: the row
 * must be inserted through the caller's transaction, so the intent and the meal
 * row either both commit or both vanish. There is deliberately no overload that
 * falls back to the injected repository — a repository here would write outside
 * the caller's transaction and turn a rollback into a phantom notification.
 */
@Injectable()
export class OutboxService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Insert one pending row through `manager`, i.e. inside the caller's
   * transaction. Returns the delivery id.
   */
  async enqueue(manager: EntityManager, entry: OutboxEntry): Promise<string> {
    const id = randomUUID();
    await manager.insert(Outbox, {
      id,
      ownerSub: entry.ownerSub,
      destination: entry.destination,
      payload: entry.payload,
      createdAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
    });
    return id;
  }

  /**
   * Enqueue in a transaction of its own, for a caller that has none.
   *
   * This is only safe when the work it accompanies is itself idempotent: the
   * intent can commit while that work does not, so the consumer may be told
   * about something that later disappears. A caller that needs the two to be
   * inseparable must use `enqueue` with its own transaction's manager.
   */
  enqueueFor(ownerSub: string, destination: string, payload: string): Promise<string> {
    return this.dataSource.transaction((manager) =>
      this.enqueue(manager, { ownerSub, destination, payload }),
    );
  }

  /**
   * This owner's unpublished intents, oldest first, at most `limit` of them.
   *
   * The drain read a deliverer makes, and deliberately **not** a cached read: the
   * queue is a work list, so a cached answer would hand the same intents to two
   * callers. It is therefore the one read in this service that does not go through
   * `getThrough` — a documented deviation from the cache contract, not an oversight.
   */
  async pendingFor(ownerSub: string, limit: number): Promise<PendingIntent[]> {
    const rows = await this.dataSource.getRepository(Outbox).find({
      select: { id: true, destination: true, payload: true },
      where: { ownerSub, publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      destination: row.destination,
      payload: row.payload,
    }));
  }

  /**
   * Store the outcome of one delivery attempt per row, in one transaction.
   *
   * Every write is scoped by `ownerSub` as well as `id`, so an id belonging to
   * another owner matches no row and is ignored — it is not the caller's business
   * whether that row exists. Returns how many rows were actually written, which is
   * how a caller can tell a foreign id from its own.
   *
   * A published row keeps a reason when the caller supplied one: "published with a
   * reason" is how a case that must stop retrying (a 403 — revoked, or never
   * granted) is closed while remaining diagnosable. The plain success case passes no
   * reason and the column is cleared.
   */
  recordOutcomes(ownerSub: string, outcomes: OutboxOutcome[]): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      let written = 0;
      for (const outcome of outcomes) {
        const change = outcomeChange(outcome);
        const result = await manager.update(Outbox, { id: outcome.id, ownerSub }, change);
        written += result.affected ?? 0;
      }
      return written;
    });
  }
}

/** The columns one outcome writes, and nothing else. */
function outcomeChange(outcome: OutboxOutcome): QueryDeepPartialEntity<Outbox> {
  if (outcome.published) {
    return {
      publishedAt: new Date(),
      lastError: outcome.lastError === undefined ? null : oneLine(outcome.lastError),
    };
  }
  return {
    // Pending, and measurably so: `attempts` climbs on every failed attempt, which
    // is a diagnostic counter and never a retry limit.
    attempts: () => '"attempts" + 1',
    lastError: oneLine(outcome.lastError ?? 'delivery failed'),
  };
}
