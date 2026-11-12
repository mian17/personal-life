import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { MealGroup } from '../../entries/dto/create-entry.dto.js';
import { TargetService } from '../../targets/target.service.js';
import { OutboxService } from '../outbox.service.js';
import { MealTodoToggle } from './meal-toggle.entity.js';

import {
  TODOS_COMPLETE,
  TODOS_CREATE,
  TODO_GROUPS,
  createIntent,
  isTodoGroup,
  tickIntent,
  type TodoGroup,
} from './todo-intents.js';

/** A failure reason flattened to one line for the ids-only log. */
function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Decides which todo intents an owner is owed and writes them to the outbox
 * (`SPEC-todo-origin` §7, `docs/roadmap/research/outbox-atomicity.md` §1).
 *
 * Two triggers, both of them cheap:
 * - the day's three creates, once the owner has enabled the integration;
 * - one tick per logged entry, so ticking the task in the todo app and logging
 *   the meal in this one are the same act.
 *
 * Three rules hold everywhere below:
 * - every method takes the caller's `EntityManager`, so an intent commits with
 *   the row it accompanies and a rollback takes both away;
 * - `originId` is stable per group, so re-enqueueing a create is intended and
 *   harmless — the duplicate is answered by todo-service's unique index and
 *   treated as success by the delivery layer. Nothing here reads the outbox to
 *   deduplicate: that read would be inside the caller's transaction, it would
 *   cost a query on every meal log, and it would make correctness depend on
 *   rows another process may already have published;
 * - a failure here is degraded, never propagated. Telling another service about
 *   a meal is worth a missing message; it is never worth failing the user's
 *   meal log, so every decide-and-enqueue step is guarded and one ids-only line
 *   records the miss (no titles, no content).
 */
@Injectable()
export class MealTodoProducerService {
  private readonly logger = new Logger(MealTodoProducerService.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly targets: TargetService,
  ) {}

  /**
   * Enqueue one create per meal group for `today`, when the owner has enabled
   * the integration. Idempotent by `originId`, so calling it again on the same
   * day enqueues the same three intents and changes nothing downstream.
   */
  async ensureDailyTasks(ownerSub: string, today: string, manager: EntityManager): Promise<void> {
    await this.degrading('daily tasks', ownerSub, async () => {
      if (!(await this.isEnabled(ownerSub, manager))) return;
      const target = await this.targets.getTarget(ownerSub, today);
      for (const group of TODO_GROUPS) {
        await this.enqueueCreate(ownerSub, group, target.calories, today, manager);
      }
    });
  }

  /**
   * Enqueue the tick for one logged entry. `snack` has no daily task, so it has
   * nothing to tick and is skipped.
   */
  async noteEntryLogged(
    ownerSub: string,
    group: MealGroup,
    today: string,
    manager: EntityManager,
  ): Promise<void> {
    if (!isTodoGroup(group)) return;
    await this.degrading('entry tick', ownerSub, async () => {
      if (!(await this.isEnabled(ownerSub, manager))) return;
      await this.outbox.enqueue(manager, {
        ownerSub,
        destination: TODOS_COMPLETE,
        payload: JSON.stringify(tickIntent(group, today)),
      });
    });
  }

  /** Whether this owner turned the integration on; a revoked row is an absent one. */
  private async isEnabled(ownerSub: string, manager: EntityManager): Promise<boolean> {
    const toggle = await manager.getRepository(MealTodoToggle).findOne({ where: { ownerSub } });
    return toggle !== null;
  }

  /** One create intent, in the caller's transaction. */
  private enqueueCreate(
    ownerSub: string,
    group: TodoGroup,
    calories: number,
    today: string,
    manager: EntityManager,
  ): Promise<string> {
    return this.outbox.enqueue(manager, {
      ownerSub,
      destination: TODOS_CREATE,
      payload: JSON.stringify(createIntent(group, calories, today)),
    });
  }

  /**
   * Run one decide-and-enqueue step, turning a failure into a missed message and
   * a single ids-only log line. The caller's write is never affected.
   */
  private async degrading(
    what: string,
    ownerSub: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.warn(`todo producer skipped ${what} for ${ownerSub}: ${oneLine(err)}`);
    }
  }
}
