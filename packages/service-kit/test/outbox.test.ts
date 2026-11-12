import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import {
  OUTBOX_DELIVERY,
  OUTBOX_ERROR_MAX_CHARS,
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_SWEEP_BATCH,
  Outbox,
  OutboxModule,
  OutboxPollerService,
  OutboxService,
  TODOS_API_URL_ENV,
  createHttpDelivery,
  oneLine,
  type OutboxDelivery,
  type OutboxMessage,
} from '../src/index.js';

/**
 * The extraction seam: what `OutboxModule.forRoot()` promises a producer service.
 *
 * Two things are checked here and nowhere else, because they are what the move
 * out of `apps/meal-service` decided:
 * - the module is assembled from options, so a second producer supplies its own
 *   sender instead of forking the package — and a caller that supplies nothing
 *   keeps the inert default rather than sending an unauthenticated request;
 * - the table is one fixed `outbox`, with the pending index. Each service owns its
 *   own database file, so the name needs no parameter (`audit_log` precedent).
 *
 * No database and no driver: the entity is read from TypeORM's own metadata, and
 * the sender is a plain object. The delivery behaviour itself (a sweep publishes,
 * retries, caps a reason) lives in the app's own outbox suite over real SQLite.
 */

const SUB = 'user-a';

/** One row as a sender receives it. */
const message: OutboxMessage = {
  id: '00000000-0000-4000-8000-000000000000',
  ownerSub: SUB,
  destination: 'todos.create',
  payload: '{}',
};

/** A sender that records what it was handed. */
function fakeDelivery(): OutboxDelivery & { delivered: OutboxMessage[] } {
  const delivered: OutboxMessage[] = [];
  return {
    delivered,
    deliver: async (row) => {
      delivered.push(row);
    },
  };
}

/** The provider registered under one token, as a factory this suite can call. */
function providerFactory(
  dynamicModule: { providers?: unknown[] },
  provide: unknown,
): (() => unknown) | undefined {
  const providers = dynamicModule.providers ?? [];
  const provider = providers.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      candidate.provide === provide,
  );
  return provider !== undefined && 'useFactory' in provider
    ? (provider.useFactory as () => unknown)
    : undefined;
}

describe('OutboxModule.forRoot', () => {
  it('exports the writer and the relay, and never a producer', () => {
    // A producer in the kit would be the fork this extraction exists to prevent.
    expect(OutboxModule.forRoot().exports).toEqual([OutboxService, OutboxPollerService]);
  });

  it('provides the delivery the caller supplied, through one injection token', () => {
    const delivery = fakeDelivery();
    const dynamicModule = OutboxModule.forRoot({ delivery });

    expect(providerFactory(dynamicModule, OUTBOX_DELIVERY)?.()).toBe(delivery);
  });

  it('gives a caller that supplies nothing the inert default, not an unauthenticated send', async () => {
    const defaulted = createHttpDelivery({});

    expect(defaulted.configured).toBe(false);
    await expect(defaulted.deliver(message)).rejects.toThrow(
      `outbox delivery disabled: ${TODOS_API_URL_ENV} is unset`,
    );
    // A URL alone is still no credential: the request must never be attempted.
    await expect(
      createHttpDelivery({ [TODOS_API_URL_ENV]: 'http://todos' }).deliver(message),
    ).rejects.toThrow('outbox delivery not configured: no producer credential for http://todos');
  });

  it('keeps the entity on one `outbox` table with the pending index', () => {
    const storage = getMetadataArgsStorage();
    const table = storage.tables.find((entry) => entry.target === Outbox);
    const index = storage.indices.find((entry) => entry.target === Outbox);

    expect(table?.name).toBe('outbox');
    expect(index?.name).toBe('IDX_outbox_pending');
    expect(index?.columns).toEqual(['publishedAt', 'createdAt']);
  });

  it('keeps the documented interval, batch and reason-length constants', () => {
    expect(OUTBOX_POLL_INTERVAL_MS).toBe(5_000);
    expect(OUTBOX_SWEEP_BATCH).toBe(20);
    expect(OUTBOX_ERROR_MAX_CHARS).toBe(256);
  });

  it('flattens a reason through the one exported `oneLine`', () => {
    expect(oneLine(new Error('two\n  spaces\tand a tab'))).toBe('two spaces and a tab');
    expect(oneLine(`${'x'.repeat(OUTBOX_ERROR_MAX_CHARS)}trailing`)).toHaveLength(
      OUTBOX_ERROR_MAX_CHARS,
    );
  });
});
