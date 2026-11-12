import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, type EntityManager, type Repository } from 'typeorm';
import { OUTBOX_DELIVERY, type OutboxDelivery, type OutboxMessage } from './outbox-delivery.js';
import { Outbox } from './outbox.entity.js';

/**
 * How long between sweeps. Short enough that a "tell todo-service" intent lands
 * within a user-visible beat, long enough that an idle service costs one query
 * per interval per service. There is no push wakeup yet; a sweep that finds
 * nothing is one indexed `LIMIT 20` read.
 */
export const OUTBOX_POLL_INTERVAL_MS = 5_000;

/** Rows one sweep drains. Bounded so a backlog can never monopolize one tick. */
export const OUTBOX_SWEEP_BATCH = 20;

/** `lastError` carries one diagnostic line, never a stack. */
export const OUTBOX_ERROR_MAX_CHARS = 256;

/**
 * One failure reason, flattened to a single capped line.
 *
 * Shared with the drain route's outcome write (`OutboxService.recordOutcomes`), so a
 * reason reaches `lastError` the same way whichever caller recorded it.
 */
export function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, OUTBOX_ERROR_MAX_CHARS);
}

/**
 * The relay half of the outbox (`docs/roadmap/research/outbox-atomicity.md`
 * §2, §5): a polling publisher, one per service database, draining the oldest
 * pending rows in `createdAt` order and marking each one only after the sender
 * returned successfully.
 *
 * Mirrors `ReminderService` deliberately — one interval, `unref()`ed, cleared on
 * destroy, and a `sweep()` that returns a count instead of throwing. The rules
 * that keep it safe:
 * - rows are delivered **sequentially**; a batch fanned out in parallel would
 *   reorder same-aggregate intents (`§4`);
 * - a failed row keeps `publishedAt` null, so the next sweep retries it (at
 *   least once) and the consumer's dedup absorbs the replay (§3);
 * - one bad row never stops the rest of the batch or the interval;
 * - with delivery unconfigured the poller warns exactly once and sends nothing,
 *   leaving every row pending rather than publishing or deleting it.
 */
@Injectable()
export class OutboxPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** A sweep is already walking the batch; a second one would double-send. */
  private sweeping = false;
  private warnedUnconfigured = false;

  constructor(
    @InjectRepository(Outbox) private readonly outbox: Repository<Outbox>,
    @Inject(OUTBOX_DELIVERY) private readonly delivery: OutboxDelivery,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), OUTBOX_POLL_INTERVAL_MS);
    // A worker that exits before onModuleDestroy must not be held open by this
    // timer; `unref` lets the process end while the interval still fires.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deliver every pending row this sweep can, oldest first. Returns how many were published. */
  async sweep(): Promise<number> {
    if (this.delivery.configured === false) {
      this.warnOnceUnconfigured();
      return 0;
    }
    if (this.sweeping) return 0;

    this.sweeping = true;
    try {
      const pending = await this.oldestPending();
      return await this.deliverAll(pending);
    } catch (err) {
      // The read itself failed (busy file, missing table). The rows are still
      // pending, so the next tick retries; the interval must survive either way.
      this.logger.error(`outbox sweep failed: ${oneLine(err)}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private oldestPending(): Promise<Outbox[]> {
    return this.outbox.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: OUTBOX_SWEEP_BATCH,
    });
  }

  private async deliverAll(pending: Outbox[]): Promise<number> {
    let published = 0;
    for (const row of pending) {
      if (await this.deliverOne(row)) published += 1;
    }
    return published;
  }

  /**
   * One row's attempt: deliver, then record the outcome. This never throws — a
   * delivery failure is stored on the row for the next sweep, and a failure of
   * that store is logged — because one bad row must not stop the rows behind it.
   */
  private async deliverOne(row: Outbox): Promise<boolean> {
    try {
      await this.delivery.deliver(toMessage(row));
    } catch (err) {
      await this.recordFailureQuietly(row.id, oneLine(err));
      return false;
    }
    try {
      await this.markPublished(row.id);
    } catch (err) {
      // The send succeeded but the mark did not: the row stays pending, so the
      // next sweep re-sends it. That is the pattern's one duplicate, not a loss.
      this.logger.error(`outbox publish not recorded for ${row.id}: ${oneLine(err)}`);
      return false;
    }
    return true;
  }

  private async recordFailureQuietly(id: string, reason: string): Promise<void> {
    try {
      await this.recordFailure(id, reason);
    } catch (err) {
      this.logger.error(`outbox failure not recorded for ${id}: ${oneLine(err)}`);
    }
  }

  private async markPublished(id: string): Promise<void> {
    await this.writeImmediate((manager) =>
      manager.update(Outbox, { id }, { publishedAt: new Date(), lastError: null }),
    );
  }

  private async recordFailure(id: string, reason: string): Promise<void> {
    await this.writeImmediate((manager) =>
      manager.update(Outbox, { id }, { attempts: () => '"attempts" + 1', lastError: reason }),
    );
  }

  /**
   * The poller's own write, in `BEGIN IMMEDIATE` (`db-primaries.md` §2): the
   * poller and the business writer share one SQLite file, and an immediate
   * transaction surfaces a busy file at the start instead of partway through,
   * after which SQLite guarantees no further `SQLITE_BUSY`. The connection's
   * `busy_timeout` is what makes the start wait rather than fail outright.
   *
   * TypeORM's own `transaction()` emits a plain `BEGIN`, so the statement is
   * issued here on the query runner and the write runs through its manager —
   * the same connection, the same transaction.
   *
   * `better-sqlite3` hands out ONE shared query runner, so a write that lands
   * while a request already holds a transaction joins it instead of opening a
   * second one (a nested `BEGIN` would fail, and its `COMMIT` would end the
   * caller's transaction).
   *
   * ponytail: per-write isolation on SQLite needs a second connection, which
   * this driver cannot give; the upgrade path is the Postgres driver in prod.
   */
  private async writeImmediate(work: (manager: EntityManager) => Promise<unknown>): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      if (runner.isTransactionActive) {
        await work(runner.manager);
        return;
      }
      await runner.query('BEGIN IMMEDIATE');
      try {
        await work(runner.manager);
        await runner.query('COMMIT');
      } catch (err) {
        await runner.query('ROLLBACK');
        throw err;
      }
    } finally {
      await runner.release();
    }
  }

  private warnOnceUnconfigured(): void {
    if (this.warnedUnconfigured) return;
    this.warnedUnconfigured = true;
    this.logger.warn('outbox delivery unconfigured: rows stay pending, nothing is sent');
  }
}

/** The row slice a sender sees — no clock, no retry state, no repository. */
function toMessage(row: Outbox): OutboxMessage {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    destination: row.destination,
    payload: row.payload,
  };
}
