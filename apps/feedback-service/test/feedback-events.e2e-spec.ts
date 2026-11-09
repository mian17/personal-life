import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import {
  FakeConsumer,
  FakeEventSink,
  JwtHarness,
  canProvidePostgres,
  feedbackBody as validBody,
  feedbackId,
  listenForFeedbackEvents,
  postFeedback as post,
  rawClient,
  sleep,
  startFeedbackApp,
  startThrowawayPostgres,
  waitFor,
  waitForAsync,
  type FeedbackApp,
  type NotificationProbe,
  type ThrowawayPostgres,
} from './feedback-harness.js';

/**
 * Groups 2, 3 and 7 of `SPEC-feedback-service`'s Testing Strategy, proved
 * against a real Postgres — `pg-mem` has no faithful NOTIFY/LISTEN, and these
 * groups *are* the change log:
 *
 *  2. the trigger notifies only on commit (a real `LISTEN` receives
 *     `seq` + `event_id`); a rolled-back write notifies nothing;
 *  3. notify → confirmed publish → cursor advance; a restart replays
 *     `seq > cursor` in order, and a redelivered `event_id` dedups;
 *  7. a notification dropped by Postgres is picked up by the reconciliation
 *     tick, in order, with the same `event_id` dedup on the consumer.
 *
 * Skipped — never failed — when Docker is absent and no `FEEDBACK_TEST_DB_URL`
 * is configured; never touches a data directory or the compose `postgres-feedback`.
 */

jest.setTimeout(180_000);

const describeDb = canProvidePostgres() ? describe : describe.skip;

const OWNER = 'owner-log';
const COLUMN = `SELECT "lastSeq"::text AS seq FROM feedback_cursor WHERE id = 'feedback'`;
const HEAD = 'SELECT COALESCE(MAX(seq),0)::text AS head FROM feedback_event';

describeDb('Feedback event stream (e2e)', () => {
  let pg: ThrowawayPostgres;
  let jwt: JwtHarness;
  let dbUrl = '';

  beforeAll(async () => {
    pg = await startThrowawayPostgres('events');
    dbUrl = pg.url;
    jwt = await new JwtHarness().start();
  });

  afterAll(async () => {
    await jwt?.stop();
    await pg?.stop();
  });

  describe('2. transactional log + 7. reconciliation tick', () => {
    let app: FeedbackApp;
    let token: string;
    let probe: NotificationProbe;

    beforeAll(async () => {
      // A 250ms tick: group 7's safety net must be observable inside a test.
      app = await startFeedbackApp({ dbUrl, jwt, reconcileMs: 250 });
      token = await jwt.sign(OWNER);
      probe = await listenForFeedbackEvents(app.dataSource);
    });

    afterAll(async () => {
      // Release the probe's checked-out connection before the pool is closed.
      await probe.close();
      await app.close();
    });

    const cursor = async (): Promise<string> =>
      (await app.dataSource.query(COLUMN))[0].seq as string;
    const head = async (): Promise<string> => (await app.dataSource.query(HEAD))[0].head as string;

    it('notifies with seq + event_id on commit, and never on a rolled-back write', async () => {
      const committed = feedbackId();
      await post(app, token, validBody(committed, 'committed')).expect(201);
      await waitFor(
        () => probe.received.some((note) => note.event_id === committed),
        'NOTIFY for the committed insert',
      );

      const note = probe.received.find((entry) => entry.event_id === committed)!;
      // `json_build_object('seq', NEW.seq, …)` emits seq as a JSON number.
      expect(typeof note.seq).toBe('number');
      expect(Number.isInteger(note.seq)).toBe(true);
      expect(note.seq).toBeGreaterThan(0);
      const row = await app.dataSource.query(
        'SELECT seq::text AS seq FROM feedback_event WHERE "eventId" = $1',
        [committed],
      );
      expect(Number(row[0].seq)).toBe(note.seq);

      // The trigger fires inside the transaction; Postgres delivers only on
      // commit, so an aborted write notifies nothing and persists nothing.
      const rolledBack = feedbackId();
      const client = await rawClient(app.dataSource);
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO feedback (id, "ownerSub", app, type, title, description) VALUES ($1,$2,$3,$4,$5,$6)',
          [rolledBack, OWNER, 'notes', 'bug_report', 'enc.v1.probe-title', 'enc.v1.probe'],
        );
        await client.query(
          'INSERT INTO feedback_event ("eventId","feedbackId","ownerSub",app,type) VALUES ($1,$1,$2,$3,$4)',
          [rolledBack, OWNER, 'notes', 'bug_report'],
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      await sleep(400);
      expect(probe.received.some((entry) => entry.event_id === rolledBack)).toBe(false);
      const persisted = await app.dataSource.query(
        'SELECT COUNT(*)::int AS n FROM feedback WHERE id = $1',
        [rolledBack],
      );
      expect(persisted[0].n).toBe(0);
    });

    it('publishes a NOTIFY-dropped event on the reconciliation tick, in order, with consumer dedup', async () => {
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor at head');
      const headBefore = await head();

      // Simulate a lost notification: the log advances, the push never leaves.
      const missed = [feedbackId(), feedbackId()];
      await app.dataSource.query('ALTER TABLE feedback_event DISABLE TRIGGER feedback_notify');
      try {
        await post(app, token, validBody(missed[0], 'notification dropped one')).expect(201);
        await sleep(5);
        await post(app, token, validBody(missed[1], 'notification dropped two')).expect(201);
      } finally {
        await app.dataSource.query('ALTER TABLE feedback_event ENABLE TRIGGER feedback_notify');
      }
      expect(probe.received.some((entry) => missed.includes(entry.event_id))).toBe(false);

      // The tick is the only path that can learn about these two rows.
      await waitFor(
        () => missed.every((id) => app.sink.eventIds.includes(id)),
        'reconciliation tick publish',
        15_000,
      );
      expect(app.sink.eventIds.indexOf(missed[0])).toBeLessThan(
        app.sink.eventIds.indexOf(missed[1]),
      );
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor caught up');

      // Crash window between confirm and cursor advance: rewind the cursor and
      // let the tick replay, then prove the consumer applies each event once.
      await app.dataSource.query(
        `UPDATE feedback_cursor SET "lastSeq" = $1 WHERE id = 'feedback'`,
        [headBefore],
      );
      await waitFor(
        () => app.sink.eventIds.filter((id) => id === missed[0]).length >= 2,
        'replayed missed event',
        15_000,
      );
      expect(app.sink.consumer.duplicates).toContain(missed[0]);
      const applied = app.sink.consumer.applied.map((entry) => entry.event_id);
      expect(new Set(applied).size).toBe(applied.length);
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor back at head');
    });
  });

  describe('3. dispatcher: confirm, restart replay, consumer dedup', () => {
    /** Shared across the restart so redelivery is observable as a duplicate. */
    const consumer = new FakeConsumer();
    let first: FeedbackApp | undefined;
    let second: FeedbackApp | undefined;
    let token: string;

    const live = (): FeedbackApp => second ?? first!;

    const cursor = async (): Promise<string> =>
      (await live().dataSource.query(COLUMN))[0].seq as string;
    const head = async (): Promise<string> =>
      (await live().dataSource.query(HEAD))[0].head as string;
    const seqOf = async (id: string): Promise<string> =>
      (
        await live().dataSource.query(
          'SELECT seq::text AS seq FROM feedback_event WHERE "eventId" = $1',
          [id],
        )
      )[0].seq as string;

    beforeAll(async () => {
      first = await startFeedbackApp({
        dbUrl,
        jwt,
        sink: new FakeEventSink(consumer),
        reconcileMs: 250,
      });
      token = await jwt.sign('owner-dispatch');
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor at head');
    });

    afterAll(async () => {
      await first?.close();
      await second?.close();
    });

    it('notify → confirmed publish → cursor advance and dispatched_at stamp', async () => {
      const id = feedbackId();
      await post(first!, token, validBody(id, 'pushed immediately')).expect(201);
      await waitFor(() => first!.sink.eventIds.includes(id), 'confirmed publish');

      expect(first!.sink.published.find((body) => body.event_id === id)).toEqual({
        event_id: id,
        feedback_id: id,
        owner_sub: 'owner-dispatch',
        app: 'notes',
        type: 'bug_report',
        occurred_at: expect.any(String),
      });
      const body = first!.sink.published.find((entry) => entry.event_id === id)!;
      expect(Number.isNaN(Date.parse(body.occurred_at))).toBe(false);

      // The cursor moves only after the broker confirm.
      const expected = await seqOf(id);
      await waitForAsync(async () => (await cursor()) === expected, 'cursor advanced');
      const rows = await first!.dataSource.query(
        `SELECT "dispatchedAt" FROM feedback_event WHERE "eventId" = $1`,
        [id],
      );
      expect(rows[0].dispatchedAt).not.toBeNull();
    });

    it('a restart replays seq > cursor in order, and redelivery dedups on event_id', async () => {
      const resumeFrom = await cursor();
      first!.sink.fail = true; // every confirm rejects: the cursor must hold

      const pending = [feedbackId(), feedbackId()];
      for (const id of pending) {
        await post(first!, token, validBody(id, 'written while the broker is down')).expect(201);
      }
      await sleep(700); // several failed drain attempts (initial + ticks)
      expect(first!.sink.eventIds).not.toContain(pending[0]);
      expect(first!.sink.eventIds).not.toContain(pending[1]);
      expect(await cursor()).toBe(resumeFrom);

      // Restart: a fresh process resumes from the persisted cursor, never from
      // a business-row scan, and publishes strictly in seq order.
      await first!.close();
      first = undefined;
      second = await startFeedbackApp({
        dbUrl,
        jwt,
        sink: new FakeEventSink(consumer),
        reconcileMs: 250,
      });

      await waitFor(
        () =>
          second!.sink.eventIds.includes(pending[0]) && second!.sink.eventIds.includes(pending[1]),
        'restart replay',
        15_000,
      );
      expect(second!.sink.eventIds.indexOf(pending[0])).toBeLessThan(
        second!.sink.eventIds.indexOf(pending[1]),
      );
      // The sink records an event before `advance()` persists the cursor, so a
      // rewind issued the moment both ids appear can still be overwritten by
      // the in-flight advance and replay nothing. Wait for the cursor itself.
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor at head');

      // At-least-once delivery, exactly-once effect: rewind past the replayed
      // events (the crash window) and let the tick redeliver them.
      await second!.dataSource.query(
        `UPDATE feedback_cursor SET "lastSeq" = $1 WHERE id = 'feedback'`,
        [resumeFrom],
      );
      await waitFor(
        () => second!.sink.eventIds.filter((id) => id === pending[0]).length >= 2,
        'redelivery of a replayed event',
        15_000,
      );
      expect(consumer.duplicates).toContain(pending[0]);
      const applied = consumer.applied.map((entry) => entry.event_id);
      expect(new Set(applied).size).toBe(applied.length);
      expect(consumer.duplicates.every((id) => applied.includes(id))).toBe(true);
      await waitForAsync(async () => (await cursor()) === (await head()), 'cursor back at head');
    });
  });
});
