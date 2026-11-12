/**
 * The delivery seam: the poller hands one row to an injected sender, and a test
 * supplies a fake so the suite never touches the network.
 *
 * The sender is a pure function of the row — it reads nothing from the DB, so
 * a failure can never leave the outbox half-updated by anything but the poller.
 */

/** Nest DI token for the sender the poller calls. */
export const OUTBOX_DELIVERY = Symbol('OUTBOX_DELIVERY');

/** Env var naming the todo-service base URL the default sender would target. */
export const TODOS_API_URL_ENV = 'MEAL_TODOS_API_URL';

/** The row fields a sender may read. Deliberately a subset of the entity. */
export interface OutboxMessage {
  id: string;
  ownerSub: string;
  destination: string;
  payload: string;
}

export interface OutboxDelivery {
  /**
   * Whether this sender can deliver at all. `false` means "unconfigured": the
   * poller warns once and leaves rows pending. Absent (a test fake) means yes.
   */
  readonly configured?: boolean;

  /** Hand one row to the destination. A throw means "not delivered, retry". */
  deliver(message: OutboxMessage): Promise<void>;
}

/**
 * The default sender. It is intentionally inert: the producer credential story
 * is a later task, and a POST with no credential would be rejected by
 * todo-service's guard while burning the row's `attempts`.
 *
 * ponytail: no producer credential yet — N4 wires the OIDC client; until then
 * this refuses loudly instead of sending an unauthenticated request.
 */
export function createHttpDelivery(env: NodeJS.ProcessEnv = process.env): OutboxDelivery {
  const baseUrl = env[TODOS_API_URL_ENV];

  return {
    configured: Boolean(baseUrl),

    async deliver(): Promise<void> {
      if (!baseUrl) {
        throw new Error(`outbox delivery disabled: ${TODOS_API_URL_ENV} is unset`);
      }
      // The URL alone is not enough to send: a request without a credential
      // would be a 401 dressed up as a retryable failure.
      throw new Error(`outbox delivery not configured: no producer credential for ${baseUrl}`);
    },
  };
}
