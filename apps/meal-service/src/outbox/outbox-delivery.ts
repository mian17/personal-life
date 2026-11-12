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
 * The default sender. It stays intentionally inert: **the live delivery path is the
 * BFF's drain** (`apps/app/lib/outbox-relay.ts`), not this poller.
 *
 * Delivery needs the user's own token, because `origin_grant` is keyed
 * `(ownerSub, clientId)` and the user's session token names the client that holds
 * that grant. A service cannot hold that credential — `clientCredentials` is disabled
 * in the IdP — so this sender has nothing to send with. The BFF drains
 * `GET /api/meal-todo/pending` and reports through `POST /api/meal-todo/published`
 * instead. The poller stays for the case where a service credential does exist, and
 * does nothing until then.
 *
 * ponytail: no producer credential, by design — the BFF drain is the delivery leg;
 * replace this sender only if a service-identity path is ever granted.
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
