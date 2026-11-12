import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { Entry } from '../src/entries/entry.entity.js';
import {
  OUTBOX_ERROR_MAX_CHARS,
  OUTBOX_SWEEP_BATCH,
  Outbox,
  OutboxPollerService,
  OutboxService,
  type OutboxDelivery,
  type OutboxMessage,
} from '@life/service-kit';

/**
 * The outbox contract (`docs/roadmap/research/outbox-atomicity.md` §1, §5, §3):
 * an intent shares the transaction of the row it belongs to, so a commit
 * carries both and a rollback carries neither; the poller then delivers every
 * pending row at least once, retrying failures instead of losing them.
 *
 * Hermetic by construction: a throwaway SQLite file in a private `mkdtemp`
 * directory (never `apps/meal-service/data/**`) and an injected fake sender, so
 * no test touches the network. The poller is built directly rather than booting
 * `AppModule`, because booting would start the real 5s interval underneath the
 * assertions.
 */

const TEST_DIR = mkdtempSync(join(tmpdir(), 'meal-outbox-'));
const TEST_DB = join(TEST_DIR, 'test-outbox.db');

const SUB = 'user-a';
const DAY = '2026-09-03';

/** Records what it was handed; `failing` ids throw, everything else succeeds. */
class FakeDelivery implements OutboxDelivery {
  readonly delivered: OutboxMessage[] = [];
  readonly failing = new Set<string>();
  configured = true;

  async deliver(message: OutboxMessage): Promise<void> {
    if (this.failing.has(message.id)) throw new Error('destination refused');
    this.delivered.push(message);
  }
}

describe('Meal outbox (e2e)', () => {
  let dataSource: DataSource;
  let outbox: OutboxService;
  let poller: OutboxPollerService;
  let delivery: FakeDelivery;

  const rows = () => dataSource.getRepository(Outbox).find({ order: { createdAt: 'ASC' } });
  const pending = () => dataSource.getRepository(Outbox).find({ where: { publishedAt: IsNull() } });

  /** A meal row in the caller's transaction — the business write the intent rides with. */
  const insertEntry = (manager: EntityManager) =>
    manager.insert(Entry, {
      id: randomUUID(),
      ownerSub: SUB,
      date: DAY,
      mealGroup: 'breakfast',
      foodId: 'food-1',
      quantity: 1,
      nutrients: 'enc.v1.test',
      version: 0,
      deletedAt: null,
    });

  const enqueueIntent = (manager: EntityManager) =>
    outbox.enqueue(manager, {
      ownerSub: SUB,
      destination: 'todos.create',
      payload: JSON.stringify({ title: 'Log breakfast' }),
    });

  const entries = () => dataSource.getRepository(Entry).count();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: TEST_DB,
      entities: [Entry, Outbox],
      synchronize: true,
    });
    await dataSource.initialize();
    outbox = new OutboxService(dataSource);
    delivery = new FakeDelivery();
    poller = new OutboxPollerService(dataSource.getRepository(Outbox), delivery, dataSource);
  });

  afterEach(async () => {
    await dataSource.getRepository(Outbox).clear();
    await dataSource.getRepository(Entry).clear();
    delivery.delivered.length = 0;
    delivery.failing.clear();
    delivery.configured = true;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource.destroy();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('commits the intent in the same transaction as the meal row', async () => {
    await dataSource.transaction(async (manager) => {
      await insertEntry(manager);
      await enqueueIntent(manager);
    });

    expect(await entries()).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  it('rolls the intent back with the meal row', async () => {
    const insert = jest.spyOn(EntityManager.prototype, 'insert');
    let txManager: EntityManager | undefined;

    await expect(
      dataSource.transaction(async (manager) => {
        txManager = manager;
        await insertEntry(manager);
        await enqueueIntent(manager);
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');

    // better-sqlite3 hands out one shared connection, so a row written through
    // the repository joins the open transaction anyway and the two counts below
    // would pass either way. The caller's own manager is what makes "same
    // transaction" true by construction, so that is asserted directly: an
    // `enqueue` that reached for the repository would insert on a different
    // manager and this comparison fails (observed).
    expect(insert.mock.contexts.map((context) => context === txManager)).toEqual([true, true]);
    expect(await entries()).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it('publishes a pending row and stamps publishedAt', async () => {
    await outbox.enqueueFor(SUB, 'todos.create', JSON.stringify({ title: 'Log breakfast' }));

    expect(await poller.sweep()).toBe(1);

    expect(delivery.delivered).toHaveLength(1);
    expect(JSON.parse(delivery.delivered[0].payload)).toEqual({ title: 'Log breakfast' });
    const [row] = await rows();
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
  });

  it('keeps a failed row pending, one-line capped reason, and retries it', async () => {
    const id = await outbox.enqueueFor(SUB, 'todos.create', '{}');
    delivery.failing.add(id);
    const longReason = new Error(`destination refused\n${'x'.repeat(400)}`);
    jest.spyOn(delivery, 'deliver').mockRejectedValueOnce(longReason);

    expect(await poller.sweep()).toBe(0);

    const [failed] = await rows();
    expect(failed.publishedAt).toBeNull();
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).not.toContain('\n');
    expect(failed.lastError!.length).toBeLessThanOrEqual(OUTBOX_ERROR_MAX_CHARS);

    delivery.failing.clear();
    expect(await poller.sweep()).toBe(1);

    const [retried] = await rows();
    expect(retried.publishedAt).toBeInstanceOf(Date);
    expect(retried.lastError).toBeNull();
  });

  it('publishes later rows even when an earlier one fails', async () => {
    const failingId = await outbox.enqueueFor(SUB, 'todos.complete', '{"id":"a"}');
    const okId = await outbox.enqueueFor(SUB, 'todos.complete', '{"id":"b"}');
    delivery.failing.add(failingId);

    expect(await poller.sweep()).toBe(1);

    expect(delivery.delivered.map((message) => message.id)).toEqual([okId]);
    const stuck = await dataSource.getRepository(Outbox).findOneByOrFail({ id: failingId });
    expect(stuck.publishedAt).toBeNull();
    expect(stuck.attempts).toBe(1);
  });

  it('leaves every row pending and warns once when delivery is unconfigured', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delivery.configured = false;
    await outbox.enqueueFor(SUB, 'todos.create', '{}');
    await outbox.enqueueFor(SUB, 'todos.create', '{}');

    expect(await poller.sweep()).toBe(0);
    expect(await poller.sweep()).toBe(0);

    expect(delivery.delivered).toHaveLength(0);
    expect(await pending()).toHaveLength(2);
    const outboxWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('outbox'));
    expect(outboxWarnings).toHaveLength(1);
  });

  it('drains at most one bounded batch per sweep', async () => {
    for (let index = 0; index < OUTBOX_SWEEP_BATCH + 1; index += 1) {
      await outbox.enqueueFor(SUB, 'todos.create', '{}');
    }

    expect(await poller.sweep()).toBe(OUTBOX_SWEEP_BATCH);
    expect(await pending()).toHaveLength(1);
  });
});
