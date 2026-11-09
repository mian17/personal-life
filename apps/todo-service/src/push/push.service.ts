import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PushSubscribeInput } from '@life/shared';
import { PushSubscription } from './push-subscription.entity.js';

/** Env var holding the VAPID public key served to the client. */
export const PUSH_VAPID_PUBLIC_KEY_ENV = 'TODO_VAPID_PUBLIC_KEY';

/**
 * The push-subscription store. Not cached: a subscription is delivery
 * capability, not domain content (Contract 2 — `push_subscription` sits outside
 * the cache). Every operation is scoped by the caller's `sub`.
 */
@Injectable()
export class PushService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
  ) {}

  /** The VAPID public key the browser needs to subscribe. */
  getPublicKey(): { publicKey: string } {
    return { publicKey: process.env[PUSH_VAPID_PUBLIC_KEY_ENV] ?? '' };
  }

  /**
   * Upsert the caller's subscription for `input.endpoint`. Scoped by
   * `(sub, endpoint)`: a second caller sharing the same endpoint can never
   * overwrite this owner's row.
   */
  async subscribe(sub: string, input: PushSubscribeInput): Promise<void> {
    const existing = await this.subscriptions.findOne({
      where: { ownerSub: sub, endpoint: input.endpoint },
    });
    if (existing) {
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      await this.subscriptions.save(existing);
      return;
    }
    await this.subscriptions.save(
      this.subscriptions.create({
        ownerSub: sub,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        createdAt: new Date(),
      }),
    );
  }

  /** Idempotent delete of the caller's subscription for `endpoint`. */
  async unsubscribe(sub: string, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ ownerSub: sub, endpoint });
  }

  /** Every subscription of `sub` (consumed by the reminders sweep in-process). */
  listFor(sub: string): Promise<PushSubscription[]> {
    return this.subscriptions.find({
      where: { ownerSub: sub },
      order: { createdAt: 'ASC' },
    });
  }
}
