import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { decryptField } from '@life/crypto';
import { Todo } from '../todos/todo.entity.js';
import { TodosService } from '../todos/todos.service.js';
import { KeysService } from '@life/service-kit';
import { PushService } from '../push/push.service.js';
import {
  type PushSender,
  REMINDER_PUSH_SENDER,
  type ReminderPayload,
  VAPID_PRIVATE_KEY_ENV,
  VAPID_PUBLIC_KEY_ENV,
} from './push-sender.js';

/** Sweep cadence. A single `setInterval` is the whole scheduling need (ponytail). */
export const SWEEP_INTERVAL_MS = 30_000;

/** Generic notification body; the title carries the todo content (D9). */
const REMINDER_BODY = 'Todo reminder';

/** Push statuses that mean the subscription is gone for good. */
const GONE = new Set([404, 410]);

/**
 * AAD for the title envelope (`SPEC-todo-service` Data model), byte-exact with
 * the writer. It is reconstructed here because the sweep decrypts the title
 * itself and `TodosService`'s copy is not exported; the format is a fixed
 * at-rest contract, not a per-call decision.
 */
function titleAad(sub: string, id: string): string {
  return `life.v1|${sub}|todo|title|${id}`;
}

/**
 * The reminder sweep (`SPEC-todo-due-repeat-notify`, D7). A system-side
 * maintenance scan — not a user read — so it queries the DB directly through
 * its **own** repository handle (the one recorded Contract 2 deviation). The
 * clear is routed through `TodosService.markReminded`, so the owner's cache is
 * invalidated by the existing generation counter; the sweep never writes the
 * todo table.
 *
 * With no VAPID credentials configured, `sweep()` is a no-op that logs once:
 * dev/test never crash on missing keys.
 */
@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private warnedNoVapid = false;

  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    @Inject(REMINDER_PUSH_SENDER) private readonly sender: PushSender,
    private readonly todosService: TodosService,
    private readonly push: PushService,
    private readonly keys: KeysService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fire every due reminder once. Returns the number of occurrences fired. */
  async sweep(): Promise<number> {
    if (!(process.env[VAPID_PUBLIC_KEY_ENV] && process.env[VAPID_PRIVATE_KEY_ENV])) {
      if (!this.warnedNoVapid) {
        this.warnedNoVapid = true;
        this.logger.warn('VAPID keys unset: reminder sweep disabled');
      }
      return 0;
    }

    // One system-wide read: due, open, untrashed rows with a scheduled reminder.
    // `<=` excludes NULL by SQL semantics, so a null reminder is never selected.
    const due = await this.todos.find({
      where: {
        deletedAt: IsNull(),
        done: false,
        reminderScheduledAt: LessThanOrEqual(new Date().toISOString()),
      },
    });

    let fired = 0;
    for (const row of due) {
      try {
        const title = decryptField(
          await this.keys.getDekForRead(row.ownerSub),
          row.title,
          titleAad(row.ownerSub, row.id),
        );
        const payload: ReminderPayload = {
          title,
          body: REMINDER_BODY,
          url: `/todos/${row.id}/edit`,
        };
        for (const subscription of await this.push.listFor(row.ownerSub)) {
          const result = await this.sender.send(row.ownerSub, subscription.endpoint, payload);
          if (GONE.has(result.statusCode)) {
            // 404/410: this exact subscription is dead — drop it and continue.
            await this.push.unsubscribe(row.ownerSub, result.endpoint);
          }
        }
        // Clear through the seam (never a direct todo write): the owner's cache
        // is invalidated after the write. One ping per occurrence.
        await this.todosService.markReminded(row.ownerSub, row.id);
        fired += 1;
      } catch (err) {
        // One undecryptable/broken row must not abort the whole sweep.
        this.logger.error(`reminder sweep failed for todo ${row.id}: ${(err as Error).message}`);
      }
    }
    return fired;
  }
}
