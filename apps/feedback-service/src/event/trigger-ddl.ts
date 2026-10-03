import type { DataSource } from 'typeorm';

/**
 * The push trigger, ensured at boot (`SPEC-feedback-service` Event stream §2).
 * There is no migration framework here (`synchronize: true`), so the DDL is
 * re-ensured on every boot: `CREATE OR REPLACE FUNCTION` + `DROP`/`CREATE
 * TRIGGER` is idempotent and cannot drift from the deployed shape.
 *
 * The payload stays tiny (`seq` + `event_id`, far under the 8000-byte NOTIFY
 * limit) — the dispatcher always loads the full row from `feedback_event` by
 * `seq`. Postgres delivers a notification only on commit, so a rolled-back
 * write never notifies.
 */
export const FEEDBACK_NOTIFY_DDL = `
CREATE OR REPLACE FUNCTION notify_feedback() RETURNS trigger AS $$
BEGIN PERFORM pg_notify('feedback_events',
  json_build_object('seq', NEW.seq, 'event_id', NEW.event_id)::text);
RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS feedback_notify ON feedback_event;
CREATE TRIGGER feedback_notify AFTER INSERT ON feedback_event
  FOR EACH ROW EXECUTE FUNCTION notify_feedback();
`;

/** The channel the trigger publishes on and the dispatcher listens on. */
export const FEEDBACK_NOTIFY_CHANNEL = 'feedback_events';

/**
 * Apply the DDL. Called once at boot by the dispatcher, after `synchronize`
 * has created `feedback_event` — an insert is impossible before the trigger
 * exists, so every insert notifies.
 */
export async function ensureFeedbackNotifyTrigger(dataSource: DataSource): Promise<void> {
  await dataSource.query(FEEDBACK_NOTIFY_DDL);
}
