import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { FeedbackEvent } from '../feedback/feedback-event.entity.js';

/** Durable topic exchange every feedback event is published to. */
const EXCHANGE = 'feedback';

/** Routing key consumers bind on (`SPEC-feedback-service` Event stream §4). */
const ROUTING_KEY = 'feedback.submitted';

/**
 * The wire body of a `feedback.submitted` message. **Metadata only** — neither
 * the title nor the description travels, as plaintext or as ciphertext, so a
 * broker (or its management UI) sits outside the at-rest boundary and never
 * learns content.
 */
export interface FeedbackSubmittedBody {
  event_id: string;
  feedback_id: string;
  owner_sub: string;
  app: string;
  type: string;
  occurred_at: string;
}

/** Map a log row to the exact published body. */
export function toSubmittedBody(event: FeedbackEvent): FeedbackSubmittedBody {
  return {
    event_id: event.eventId,
    feedback_id: event.feedbackId,
    owner_sub: event.ownerSub,
    app: event.app,
    type: event.type,
    occurred_at: event.occurredAt.toISOString(),
  };
}

/**
 * The publish seam. The dispatcher depends on this interface, never on amqplib,
 * so tests inject a fake sink that records confirms and the broker stays an
 * implementation detail (`SPEC-feedback-service` Testing strategy 3).
 */
export interface EventSink {
  /**
   * Publish one event and resolve **only after the broker has confirmed it**;
   * reject on any broker/connection failure so the dispatcher holds the cursor
   * back and replays later.
   */
  publish(body: FeedbackSubmittedBody): Promise<void>;
}

/** Nest DI token for the publisher (`EventSink`), overridable in tests. */
export const EVENT_SINK = Symbol('EVENT_SINK');

/**
 * The confirmed RabbitMQ publisher (`SPEC-feedback-service` Event stream §4): a
 * confirm channel on the durable `feedback` exchange, persistent messages,
 * success reported only after `waitForConfirms()`.
 *
 * Reconnects lazily on the next publish; the dispatcher's backoff owns the
 * retry cadence. A broker outage can therefore never touch the HTTP path —
 * writes keep committing, the log keeps the events, and `RabbitPublisher` only
 * ever fails the dispatch call that tried to reach the broker.
 */
@Injectable()
export class RabbitPublisher implements EventSink, OnModuleDestroy {
  private readonly logger = new Logger(RabbitPublisher.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private opening: Promise<ConfirmChannel> | null = null;

  constructor(private readonly url = process.env.RABBITMQ_URL) {}

  async publish(body: FeedbackSubmittedBody): Promise<void> {
    const channel = await this.channelNow();
    try {
      channel.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(body)), {
        persistent: true,
        contentType: 'application/json',
        messageId: body.event_id,
      });
      // Success is only reported after the confirm — the cursor may not move sooner.
      await channel.waitForConfirms();
    } catch (err) {
      // A closed channel must never be reused: drop it so the retry reconnects.
      this.reset();
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    this.opening = null;
    if (connection) {
      await connection.close().catch(() => undefined);
    }
  }

  private async channelNow(): Promise<ConfirmChannel> {
    if (!this.url) throw new Error('RABBITMQ_URL is not set');
    const open = this.opening ?? this.open();
    this.opening = open;
    try {
      return await open;
    } catch (err) {
      this.opening = null;
      throw err;
    }
  }

  private async open(): Promise<ConfirmChannel> {
    const connection = await connect(this.url as string);
    // Attach first: a drop during open must not leave a half-open channel behind.
    connection.on('error', () => this.reset());
    connection.on('close', () => this.reset());
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => this.reset());
    channel.on('close', () => this.reset());
    // `assertExchange` is idempotent on the attributes it declares, so the
    // durable exchange exists even if this is the first publisher after a boot.
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    this.connection = connection;
    this.channel = channel;
    this.logger.log(`connected, exchange "${EXCHANGE}"`);
    return channel;
  }

  /** Drop the client so the next publish reconnects from scratch. */
  private reset(): void {
    this.channel = null;
    this.connection = null;
    this.opening = null;
  }
}
