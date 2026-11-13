import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MEAL_TODO_DISCLOSURE, OutboxService, disclosureHash } from '@life/service-kit';
import type { MealGroup } from '../entries/dto/create-entry.dto.js';
import { TargetService } from '../targets/target.service.js';
import { MealTodoToggle } from './meal-toggle.entity.js';

import {
  TODOS_COMPLETE,
  TODOS_CREATE,
  TODOS_RENAME,
  TODO_GROUPS,
  createIntent,
  isTodoGroup,
  renameIntent,
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
 * A third trigger rides the target write: a profile change re-titles the owner's
 * open tasks, because the number in them came from the target that just changed.
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
   * Enqueue one rename per meal group, after the owner saved a new target.
   *
   * **All three groups are sent, done or not.** This service cannot see
   * todo-service's rows — the task's `done` flag is on the far side of the outbox —
   * so guessing which groups are finished would either skip a live task or need a
   * read this service has no grant for. todo-service therefore answers 409 for a
   * done task and writes nothing, which is the honest answer: `SPEC-todo-origin`'s
   * rename refuses history and the relay treats that 409 as the intended outcome.
   *
   * The signature takes `today` because `getTarget` is a dated read and the day is
   * always the caller's (lesson 0019); the intent itself carries no day, since a
   * rename names no occurrence.
   */
  async refreshTitles(ownerSub: string, today: string, manager: EntityManager): Promise<void> {
    await this.degrading('title refresh', ownerSub, async () => {
      if (!(await this.isEnabled(ownerSub, manager))) return;
      const target = await this.targets.getTarget(ownerSub, today);
      for (const group of TODO_GROUPS) {
        await this.enqueueRename(ownerSub, group, target.calories, manager);
      }
    });
  }

  /**
   * Record that `ownerSub` turned the integration on, with the sentence they were
   * shown (`SPEC-todo-origin` assumption 12).
   *
   * An upsert, so enabling twice refreshes one row rather than adding a second, and
   * the consent columns are rewritten with it — the sentence stored is always the
   * one the screen showed on the run that turned it on. This write is deliberately
   * **not** inside a `degrading` guard: a consent record that silently failed to
   * persist would leave the user enabled with no evidence of what they agreed to.
   * The enqueue that follows it keeps its own guard, because a failed intent costs
   * a task and must never cost the consent row.
   */
  async recordConsent(ownerSub: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(MealTodoToggle).upsert(
      {
        ownerSub,
        enabledAt: new Date(),
        disclosure: MEAL_TODO_DISCLOSURE,
        disclosureHash: disclosureHash(MEAL_TODO_DISCLOSURE),
      },
      ['ownerSub'],
    );
  }

  /**
   * Turn the integration off: the absence of the row is the off state.
   *
   * This deletes **only** this service's own record. `origin_grant` in todo-service
   * is left standing on purpose — revoking a producer's origin grant is a separate,
   * deliberate act (it is what stops the producer writing, in any app), so flipping
   * this switch off stops meal-service producing without silently withdrawing a
   * permission the user granted elsewhere.
   */
  async revoke(ownerSub: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(MealTodoToggle).delete({ ownerSub });
  }

  /** Whether this owner turned the integration on, for the settings switch to read. */
  async isEnabledFor(ownerSub: string, manager: EntityManager): Promise<boolean> {
    return this.isEnabled(ownerSub, manager);
  }

  /**
   * Enqueue the tick for one logged entry. `snack` has no daily task, so it has
   * nothing to tick and is skipped. The target read sits inside the guard: an
   * owner with no target profile gets a `NotFoundException` from `getTarget`,
   * and that must cost the tick, never the meal log.
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
      const target = await this.targets.getTarget(ownerSub, today);
      await this.enqueueTick(ownerSub, group, target.calories, today, manager);
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

  /** One tick intent, in the caller's transaction. */
  private enqueueTick(
    ownerSub: string,
    group: TodoGroup,
    calories: number,
    today: string,
    manager: EntityManager,
  ): Promise<string> {
    return this.outbox.enqueue(manager, {
      ownerSub,
      destination: TODOS_COMPLETE,
      payload: JSON.stringify(tickIntent(group, calories, today)),
    });
  }

  /**
   * One rename intent, in the caller's transaction — the same envelope the tick's
   * title refresh uses, minus the day.
   */
  private enqueueRename(
    ownerSub: string,
    group: TodoGroup,
    calories: number,
    manager: EntityManager,
  ): Promise<string> {
    return this.outbox.enqueue(manager, {
      ownerSub,
      destination: TODOS_RENAME,
      payload: JSON.stringify(renameIntent(group, calories)),
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
