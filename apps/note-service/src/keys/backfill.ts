import { DataSource, EntityManager } from 'typeorm';
import {
  ENC_PREFIX,
  encryptField,
  generateDek,
  unwrapDek,
  wrapDek,
} from '@life/crypto';

/**
 * `notes-backfill` core (`SPEC-notes-backfill` Behavior). Plaintext → `enc.v1`
 * envelope migration for `note.body` and `tag.name`, owner-key provisioning, and
 * the `UQ_tag_name_owner` drop.
 *
 * The module is split into a read-only `planBackfill` (dry-run) and an
 * `applyBackfill`; both take an initialized TypeORM `DataSource` so the suite can
 * drive them against a throwaway sqlite DB. Nothing here ever opens a path by
 * itself — the caller (script or test) owns the connection, and `data/**` is a
 * hard line for tests.
 *
 * Contracts:
 * - Idempotent by prefix: a stored value already starting `enc.v1.` is skipped.
 * - Owner grouping: `ownerSub` groups keys; `NULL` uses the sentinel `_legacy_`
 *   (the same value the key is filed under, so the AAD and the `user_keys` row
 *   always agree).
 * - Batched writes: each batch runs in ONE transaction. A row that cannot be
 *   encrypted aborts its whole batch and throws {@link BackfillRowError} carrying
 *   the row id; the caller exits non-zero. No partial-batch success is ever
 *   reported.
 */

/** Sentinel owner for rows whose `ownerSub IS NULL` (legacy pre-boundary rows). */
export const LEGACY_OWNER = '_legacy_';

/** `user_keys` DDL byte-identical to TypeORM's `synchronize` output. */
const USER_KEYS_DDL =
  'CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, ' +
  '"wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), ' +
  '"createdAt" datetime NOT NULL)';

const TAG_UNIQUE_INDEX = 'UQ_tag_name_owner';

/** Default batch size: small enough to bound a transaction, large enough to be one round trip. */
const DEFAULT_BATCH_SIZE = 500;

export type BackfillMode = 'plan' | 'apply';

export interface BackfillReport {
  mode: BackfillMode;
  /** Rows actually converted to `enc.v1` (apply) / queued for conversion (plan). */
  encrypted: number;
  /** Rows already carrying the `enc.v1.` prefix (never rewrapped). */
  skipped: number;
  /** `user_keys` rows inserted for owners that had none. */
  keysCreated: number;
  /** Always `0` on a returned report; any row failure throws instead. */
  errors: number;
  /** Apply: the index existed and was dropped. Plan: the index is present to drop. */
  indexDropped: boolean;
}

/** Where a per-row encryption failure happened; `id` is the row id. */
export interface BackfillContext {
  entity: 'note' | 'tag';
  id: string;
  ownerSub: string;
}

/** Injectable encryptor seam so a test can poison exactly one row. */
export type FieldEncryptor = (
  dek: Buffer,
  plaintext: string,
  aad: string,
  ctx: BackfillContext,
) => string;

export interface BackfillOptions {
  batchSize?: number;
  encryptField?: FieldEncryptor;
}

/** A row that could not be encrypted. The message always names the row id. */
export class BackfillRowError extends Error {
  constructor(
    readonly ctx: BackfillContext,
    readonly cause: unknown,
  ) {
    super(
      `backfill failed for ${ctx.entity} ${ctx.id}: ${
        cause instanceof Error ? cause.message : 'unknown error'
      }`,
    );
    this.name = 'BackfillRowError';
  }
}

interface ContentTask {
  entity: 'note' | 'tag';
  id: string;
  /** The owner group the DEK is filed under (sentinel for NULL-owner rows). */
  owner: string;
  plaintext: string;
}

function sentinel(ownerSub: string | null | undefined): string {
  return ownerSub ?? LEGACY_OWNER;
}

/**
 * AAD shapes are cross-module contracts (`SPEC-notes-at-rest` Encryption Rules):
 * note binds `life.v1|<ownerSub>|note|body|<noteId>`, tag binds
 * `life.v1|<ownerSub>|tag|name`. NULL-owner rows use `_legacy_` here because that
 * is the value their DEK is filed under — a real `sub` does not exist and every
 * row must round-trip through the same reconstructable string.
 */
function aadFor(task: ContentTask): string {
  return task.entity === 'note'
    ? `life.v1|${task.owner}|note|body|${task.id}`
    : `life.v1|${task.owner}|tag|name`;
}

async function tableExists(ds: DataSource, name: string): Promise<boolean> {
  const rows = (await ds.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  )) as unknown[];
  return rows.length > 0;
}

async function indexExists(ds: DataSource, name: string): Promise<boolean> {
  const rows = (await ds.query(
    "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
    [name],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Read every content row in the service's canonical order (`createdAt ASC, id ASC`
 * for notes; `id ASC` for tags) and split into to-encrypt / already-encrypted.
 */
async function collectTasks(ds: DataSource): Promise<{ todo: ContentTask[]; skipped: number }> {
  const noteRows = (await ds.query(
    'SELECT "id", "body", "ownerSub" FROM "note" ORDER BY "createdAt" ASC, "id" ASC',
  )) as Array<{ id: string; body: string; ownerSub: string | null }>;
  const tagRows = (await ds.query(
    'SELECT "id", "name", "ownerSub" FROM "tag" ORDER BY "id" ASC',
  )) as Array<{ id: number; name: string; ownerSub: string | null }>;

  const todo: ContentTask[] = [];
  let skipped = 0;

  for (const row of noteRows) {
    if (row.body.startsWith(ENC_PREFIX)) {
      skipped += 1;
      continue;
    }
    todo.push({ entity: 'note', id: row.id, owner: sentinel(row.ownerSub), plaintext: row.body });
  }
  for (const row of tagRows) {
    if (row.name.startsWith(ENC_PREFIX)) {
      skipped += 1;
      continue;
    }
    todo.push({
      entity: 'tag',
      id: String(row.id),
      owner: sentinel(row.ownerSub),
      plaintext: row.name,
    });
  }
  return { todo, skipped };
}

async function existingKeySubs(ds: DataSource): Promise<Set<string>> {
  if (!(await tableExists(ds, 'user_keys'))) return new Set();
  const rows = (await ds.query('SELECT "sub" FROM "user_keys"')) as Array<{ sub: string }>;
  return new Set(rows.map((r) => r.sub));
}

/**
 * Load every existing DEK (unwrap under the master key) and provision a fresh one
 * for each requested owner that has no row. Existing rows are NEVER rewrapped.
 */
async function provisionKeys(
  ds: DataSource,
  masterKey: Buffer,
  owners: Set<string>,
): Promise<{ deks: Map<string, Buffer>; created: number }> {
  const deks = new Map<string, Buffer>();
  for (const row of (await ds.query(
    'SELECT "sub", "wrappedDek" FROM "user_keys"',
  )) as Array<{ sub: string; wrappedDek: string }>) {
    deks.set(row.sub, unwrapDek(row.wrappedDek, masterKey));
  }

  const missing = [...owners].filter((owner) => !deks.has(owner));
  if (missing.length > 0) {
    await ds.transaction(async (tm: EntityManager) => {
      for (const owner of missing) {
        const dek = generateDek();
        await tm.query(
          'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,?,?)',
          [owner, wrapDek(dek, masterKey), 1, new Date().toISOString()],
        );
        deks.set(owner, dek);
      }
    });
  }
  return { deks, created: missing.length };
}

/**
 * Dry-run. Counts what `applyBackfill` would do and touches nothing — no schema
 * creation, no DEK provisioning, no UPDATE, no DROP. Safe to run against the live
 * DB while the stack is down, and byte-for-byte non-mutating (asserted by test 4).
 */
export async function planBackfill(ds: DataSource): Promise<BackfillReport> {
  const { todo, skipped } = await collectTasks(ds);
  const existing = await existingKeySubs(ds);
  const owners = new Set(todo.map((t) => t.owner));
  const keysCreated = [...owners].filter((owner) => !existing.has(owner)).length;
  return {
    mode: 'plan',
    encrypted: todo.length,
    skipped,
    keysCreated,
    errors: 0,
    indexDropped: await indexExists(ds, TAG_UNIQUE_INDEX),
  };
}

/**
 * Apply the migration. Creates `user_keys` if absent, provisions a DEK per owner
 * group, encrypts every plaintext content row in transactional batches, then
 * drops `UQ_tag_name_owner`. Throws {@link BackfillRowError} (after rolling the
 * batch back) on the first row that cannot be encrypted.
 */
export async function applyBackfill(
  ds: DataSource,
  masterKey: Buffer,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (batchSize < 1) throw new Error('batchSize must be >= 1');
  const encrypt = options.encryptField ?? encryptField;

  if (!(await tableExists(ds, 'user_keys'))) {
    await ds.query(USER_KEYS_DDL);
  }

  const { todo, skipped } = await collectTasks(ds);
  const { deks, created } = await provisionKeys(
    ds,
    masterKey,
    new Set(todo.map((t) => t.owner)),
  );

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    await ds.transaction(async (tm: EntityManager) => {
      for (const task of batch) {
        const dek = deks.get(task.owner);
        if (!dek) {
          // Cannot happen: every task owner was provisioned above. Fail closed
          // rather than write plaintext back.
          throw new BackfillRowError(
            { entity: task.entity, id: task.id, ownerSub: task.owner },
            new Error('no DEK provisioned for owner'),
          );
        }
        let envelope: string;
        try {
          envelope = encrypt(dek, task.plaintext, aadFor(task), {
            entity: task.entity,
            id: task.id,
            ownerSub: task.owner,
          });
        } catch (err) {
          // Aborts the whole batch transaction (the throw propagates through
          // `ds.transaction`); the row id is always in the message.
          throw new BackfillRowError(
            { entity: task.entity, id: task.id, ownerSub: task.owner },
            err,
          );
        }
        const table = task.entity === 'note' ? 'note' : 'tag';
        const column = task.entity === 'note' ? 'body' : 'name';
        await tm.query(`UPDATE "${table}" SET "${column}" = ? WHERE "id" = ?`, [
          envelope,
          task.id,
        ]);
      }
    });
  }

  const indexWasPresent = await indexExists(ds, TAG_UNIQUE_INDEX);
  if (indexWasPresent) {
    await ds.query(`DROP INDEX IF EXISTS "${TAG_UNIQUE_INDEX}"`);
  }

  return {
    mode: 'apply',
    encrypted: todo.length,
    skipped,
    keysCreated: created,
    errors: 0,
    indexDropped: indexWasPresent,
  };
}

/** One deterministic line both modes print (counts only, never content/id). */
export function formatBackfillReport(report: BackfillReport): string {
  return (
    `notes-backfill [${report.mode}]: encrypted=${report.encrypted} ` +
    `skipped=${report.skipped} keysCreated=${report.keysCreated} ` +
    `errors=${report.errors} indexDropped=${report.indexDropped}`
  );
}
