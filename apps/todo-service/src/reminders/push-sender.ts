import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushService } from '../push/push.service.js';

/** DI token for the injectable push sender; a test fake overrides it. */
export const REMINDER_PUSH_SENDER = Symbol('REMINDER_PUSH_SENDER');

/** Env vars carrying the VAPID application-server credentials (spec D9). */
export const VAPID_PUBLIC_KEY_ENV = 'TODO_VAPID_PUBLIC_KEY';
export const VAPID_PRIVATE_KEY_ENV = 'TODO_VAPID_PRIVATE_KEY';
export const VAPID_SUBJECT_ENV = 'TODO_VAPID_SUBJECT';

/** The notification payload the service worker renders. Never persisted (D9). */
export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * The push-delivery seam. `endpoint` identifies the subscription being
 * attempted and is echoed back alongside the HTTP `statusCode`, so the caller
 * can delete exactly that row on `404`/`410` (`SPEC-todo-due-repeat-notify`).
 */
export interface PushSender {
  send(
    sub: string,
    endpoint: string,
    payload: ReminderPayload,
  ): Promise<{ endpoint: string; statusCode: number }>;
}

/**
 * Production `web-push` adapter. VAPID details are set once at construction,
 * and only when both keys are present, so an unconfigured service still boots.
 * The subscription keys are resolved from the stored row for `(sub, endpoint)`
 * (the seam carries only the endpoint, and web-push needs `p256dh`/`auth` to
 * encrypt); a missing row surfaces as `404`, which the sweep treats as "delete
 * this subscription" (idempotent).
 *
 * Never throws: a push-service error surfaces its HTTP status (`0` = unknown
 * transport failure) so one bad subscription can never abort the sweep.
 */
@Injectable()
export class WebPushSender implements PushSender {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly configured: boolean;

  constructor(private readonly push: PushService) {
    const publicKey = process.env[VAPID_PUBLIC_KEY_ENV];
    const privateKey = process.env[VAPID_PRIVATE_KEY_ENV];
    this.configured = Boolean(publicKey && privateKey);
    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        process.env[VAPID_SUBJECT_ENV] ?? 'mailto:admin@example.com',
        publicKey,
        privateKey,
      );
    }
  }

  async send(
    sub: string,
    endpoint: string,
    payload: ReminderPayload,
  ): Promise<{ endpoint: string; statusCode: number }> {
    if (!this.configured) return { endpoint, statusCode: 0 };

    const row = (await this.push.listFor(sub)).find((s) => s.endpoint === endpoint);
    if (!row) return { endpoint, statusCode: 404 };

    try {
      const result = await webpush.sendNotification(
        { endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
      );
      return { endpoint, statusCode: result.statusCode };
    } catch (err) {
      const statusCode = err instanceof webpush.WebPushError ? err.statusCode : 0;
      this.logger.warn(`push send failed (${statusCode}) for sub ${sub}`);
      return { endpoint, statusCode };
    }
  }
}
