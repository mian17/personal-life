import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, type Repository } from 'typeorm';
import { FeedbackCursor } from '../feedback/feedback-cursor.entity';
import { FeedbackEvent } from '../feedback/feedback-event.entity';
import { EVENT_SINK, toSubmittedBody, type EventSink } from './publisher.service';
import { ensureFeedbackNotifyTrigger, FEEDBACK_NOTIFY_CHANNEL } from './trigger-ddl';

/** The singleton cursor row (`feedback_cursor.id`). */
const CURSOR_ID = 'feedback';
/** Bounded ordered read over the change log — never a business-row scan. */
const BATCH = 500;
/** Reconnect backoff: doubles from 1s to a 30s ceiling while the broker is down. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Reconciliation tick (safety net for dropped notifications); default 60s. */
const DEFAULT_RECONCILE_MS = 60_000;

/**
 * The narrow slice of a pg client the LISTEN path needs. `dataSource.driver`
 * is `any` in TypeORM's typings, so the pool surface is declared here instead
 * of importing `pg` (whose types are not installed).
 */
interface ListenerClient {
  query(text: string): Promise<unknown>;
  on(event: 'notification', listener: (msg: { channel: string; payload?: string }) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'end', listener: () => void): void;
  release(err?: Error | boolean): void;
}
interface ListenerPool {
  connect(): Promise<ListenerClient>;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The durable dispatcher (`SPEC-feedback-service` Event stream §§3–6): one
 * persistent `LISTEN feedback_events` connection (push, immediate), a
 * `feedback_event` cursor walk for recovery, and a 60s reconciliation tick as
 * the backstop for dropped notifications. There is **no** selector loop over
 * business rows: every read here is by `seq` cursor over `feedback_event`.
 *
 * All three triggers (notify, reconnect, tick) funnel into one serialized
 * `drain()`, so events are always published strictly in `seq` order and a
 * missed notification is indistinguishable from a slow one. The cursor
 * advances only after the broker confirms; a crash between the two replays
 * that event on restart, and the consumer's `event_id` dedup makes the replay
 * harmless (at-least-once delivery, exactly-once effect).
 */
@Injectable()
export class DispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DispatcherService.name);

  private listener: ListenerClient | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  /** Serializes every drain attempt, in order, regardless of trigger. */
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    @InjectRepository(FeedbackEvent) private readonly events: Repository<FeedbackEvent>,
    @InjectRepository(FeedbackCursor) private readonly cursor: Repository<FeedbackCursor>,
    @Inject(EVENT_SINK) private readonly sink: EventSink,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Trigger first: no insert may happen before it exists. Then the resume
    // point, so a first boot starts from an empty log rather than nothing.
    await ensureFeedbackNotifyTrigger(this.dataSource);
    await this.seedCursor();
    const reconcileMs = Number(process.env.FEEDBACK_RECONCILE_MS) || DEFAULT_RECONCILE_MS;
    this.ticker = setInterval(() => this.trigger(), reconcileMs);
    this.ticker.unref?.();
    // Startup recovery is the same code path as every other trigger.
    this.trigger();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.dropListener();
  }

  /** Any trigger: notification, tick, or reconnect — they all drain the log. */
  private trigger(): void {
    if (this.stopped || this.retryTimer) return; // a backoff owns the next attempt
    this.chain = this.chain.then(() => this.attempt()).then(
      () => this.onSuccess(),
      (err) => this.onFailure(err),
    );
  }

  /** (Re)establish the listener if needed, then drain the log. */
  private async attempt(): Promise<void> {
    if (this.stopped) return;
    await this.ensureListener();
    await this.drain();
  }

  private onSuccess(): void {
    this.backoffMs = RECONNECT_MIN_MS;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private onFailure(err: unknown): void {
    this.logger.error(`dispatch failed (log keeps the events, replay is safe): ${describe(err)}`);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.trigger();
    }, delay);
  }

  private async ensureListener(): Promise<void> {
    if (this.listener || this.stopped) return;
    const pool = (this.dataSource.driver as unknown as { master: ListenerPool }).master;
    const client = await pool.connect();
    // Handlers before LISTEN so a notification can never land between the two.
    client.on('notification', (msg) => {
      if (msg.channel === FEEDBACK_NOTIFY_CHANNEL) this.trigger();
    });
    const onLost = (err?: Error): void => {
      if (this.listener !== client) return;
      this.logger.error(`LISTEN connection lost${err ? `: ${err.message}` : ''}`);
      this.dropListener();
      this.scheduleRetry();
    };
    client.on('error', onLost);
    client.on('end', () => onLost());
    try {
      await client.query(`LISTEN ${FEEDBACK_NOTIFY_CHANNEL}`);
    } catch (err) {
      client.release(true);
      throw err;
    }
    this.listener = client;
    this.logger.log(`listening on ${FEEDBACK_NOTIFY_CHANNEL}`);
  }

  private dropListener(): void {
    const listener = this.listener;
    this.listener = null;
    try {
      listener?.release(true);
    } catch {
      /* already gone */
    }
  }

  /**
   * Bounded ordered walk from the persisted cursor, publishing each event in
   * order. A missed NOTIFY is absorbed here: the next trigger walks from the
   * cursor and publishes the skipped row anyway. Never touches `feedback`.
   */
  private async drain(): Promise<void> {
    for (;;) {
      const lastSeq = await this.readCursor();
      const rows = await this.events.find({
        where: { seq: MoreThan(lastSeq) },
        order: { seq: 'ASC' },
        take: BATCH,
      });
      if (rows.length === 0) return;
      for (const row of rows) {
        await this.sink.publish(toSubmittedBody(row));
        await this.advance(row); // cursor moves only after the broker confirm
      }
      if (rows.length < BATCH) return;
    }
  }

  private async readCursor(): Promise<string> {
    const row = await this.cursor.findOne({ where: { id: CURSOR_ID } });
    return row?.lastSeq ?? '0';
  }

  /**
   * Stamp `dispatched_at` (observability only), then move the cursor. A crash
   * between the publish confirm and this leaves the cursor behind, so the
   * event replays on restart — the documented at-least-once delivery.
   */
  private async advance(event: FeedbackEvent): Promise<void> {
    await this.events.update({ seq: event.seq }, { dispatchedAt: new Date() });
    await this.cursor.update({ id: CURSOR_ID }, { lastSeq: event.seq });
  }

  /** Seed the singleton resume point on first boot. */
  private async seedCursor(): Promise<void> {
    await this.dataSource.query(
      'INSERT INTO feedback_cursor (id, "lastSeq") VALUES ($1, 0) ON CONFLICT (id) DO NOTHING',
      [CURSOR_ID],
    );
  }
}
