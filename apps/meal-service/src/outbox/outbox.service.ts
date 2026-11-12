import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
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
}
