import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ENC_PREFIX,
  decryptField,
  encryptField,
  generateDek,
  loadMasterKeyFromEnv,
  unwrapDek,
  wrapDek,
} from '@life/crypto';
import { snapshotAndVerify, uniqueSnapshotPath } from '@life/db';
import { resolveDbPath } from '@life/shared/node';

/**
 * `import-tags` core (`SPEC-tags-extraction` Migration script + Testing
 * Strategy). The one-time, human-run migration that moves the note DB's `tag`
 * rows into the tag registry, re-encrypted under the registry's own DEKs, then
 * performs the note-DB schema surgery (association-only `note_tag`).
 *
 * Ordering is the contract (mirrors `backfill-owner`):
 *   1. self-verified backup of every DB that EXISTS (`VACUUM INTO` +
 *      `quick_check`) — no write of any kind precedes it; an absent `tags.db`
 *      (first run, registry not booted) is skipped, not an error.
 *   2. registry schema bootstrap (`tag`/`user_keys`, byte-equivalent to the
 *      entities) — the registry service has not booted yet.
 *   3. id-preserving import; dual-read input (`enc.v1.` decrypted with the note
 *      DEKs, legacy plaintext passed through), always re-encrypted under the
 *      registry DEKs; NULL owners file under the `_legacy_` sentinel.
 *   4. case-variant merge: duplicates per owner merge onto the lowest id,
 *      `note_tag` repointed (duplicates deduped first so the `(noteId, tagId)`
 *      PK cannot be violated).
 *   5. schema surgery last: `note_tag` rebuilt without the FK to `tag`, then the
 *      note DB's `tag` table dropped (`PRAGMA foreign_keys = OFF` window).
 *
 * Idempotent by construction: an id already in the registry is skipped, an
 * absent `tag` table / already-rebuilt `note_tag` is skipped, and batches are
 * transactional (a poisoned row aborts its batch with the row id, non-zero exit).
 * The module never opens a real `apps/*​/data/**` path by itself — the caller
 * (script or test) owns the arguments.
 */

/** Sentinel owner for source rows whose `ownerSub IS NULL` (`SPEC-notes-backfill`). */
export const LEGACY_OWNER = '_legacy_';

/** Env var holding the note-service master key (unwrap the note DEKs). */
export const NOTE_MASTER_KEY_ENV = 'NOTE_MASTER_KEY';
/** Env var holding the registry master key (wrap the registry DEKs). */
export const TAGS_MASTER_KEY_ENV = 'TAGS_MASTER_KEY';

/**
 * Defaults anchored at the repository root via this module's own directory
 * (`apps/tags-service/src/tags`), so the documented repo-root command opens the
 * right files regardless of cwd — the `note-service` `db.ts` precedent.
 */
export const DEFAULT_NOTE_DB_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'note-service',
  'data',
  'life.db',
);
export const DEFAULT_TAGS_DB_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'tags-service',
  'data',
  'tags.db',
);

/** `tag` DDL byte-equivalent to the registry `Tag` entity's `synchronize` output. */
const TAG_DDL =
  'CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
  '"name" text NOT NULL, "ownerSub" text NOT NULL, "version" integer NOT NULL DEFAULT (0), ' +
  '"createdAt" datetime NOT NULL)';
const TAG_OWNER_INDEX_DDL = 'CREATE INDEX "IDX_tag_owner_sub" ON "tag" ("ownerSub")';
/** `user_keys` DDL byte-equivalent to the registry `UserKeys` entity. */
const USER_KEYS_DDL =
  'CREATE TABLE "user_keys" ("sub" text PRIMARY KEY NOT NULL, ' +
  '"wrappedDek" text NOT NULL, "kekVersion" integer NOT NULL DEFAULT (1), ' +
  '"createdAt" datetime NOT NULL)';

/**
 * Rebuilt `note_tag` DDL, byte-equivalent to the T5 `NoteTag` join entity: PK
 * `(noteId, tagId)`, `noteId` FK → `note(id)` `ON DELETE CASCADE`, and **no** FK
 * to the (now external) `tag` vocabulary.
 */
const NOTE_TAG_TEMP_DDL =
  'CREATE TABLE "temporary_note_tag" ("noteId" varchar NOT NULL, "tagId" integer NOT NULL, ' +
  'CONSTRAINT "FK_ddfc0b18dcc060cb8899a249910" FOREIGN KEY ("noteId") REFERENCES "note" ("id") ' +
  'ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("noteId", "tagId"))';

/** Default batch size (one transaction bounds one batch). */
const DEFAULT_BATCH_SIZE = 500;

export type ImportMode = 'plan' | 'apply';

export interface ResolvedPaths {
  noteDbPath: string;
  tagsDbPath: string;
}

export interface ImportCounts {
  imported: number;
  skipped: number;
  merges: number;
  keysCreated: number;
}

export interface ImportReport extends ImportCounts {
  mode: ImportMode;
  /** Always `0` on a returned report; any row failure throws instead. */
  errors: number;
  /** Apply: the verified note-DB backup path. Plan: `null`. */
  noteBackupPath: string | null;
  /** Apply: the verified `tags.db` backup path, or `null` when it did not exist. */
  tagsBackupPath: string | null;
  /** Apply: the schema-surgery actions taken/skipped. Plan: empty. */
  surgeryActions: string[];
}

/** Where a per-row encryption failure happened; `id` is the tag row id. */
export interface ImportRowContext {
  id: number;
  owner: string;
}

/** Injectable encryptor seam so a test can poison exactly one row. */
export type FieldEncryptor = (
  dek: Buffer,
  plaintext: string,
  aad: string,
  ctx: ImportRowContext,
) => string;

export interface ImportOptions {
  batchSize?: number;
  encryptField?: FieldEncryptor;
}

/** A row that could not be imported. The message always names the row id. */
export class ImportRowError extends Error {
  constructor(
    readonly rowId: number,
    readonly owner: string,
    readonly cause: unknown,
  ) {
    super(
      `import-tags failed for tag ${rowId}: ${
        cause instanceof Error ? cause.message : 'unknown error'
      }`,
    );
    this.name = 'ImportRowError';
  }
}

interface SourceTag {
  id: number;
  name: string;
  ownerSub: string | null;
}

interface InsertTask {
  id: number;
  owner: string;
  plaintext: string;
}

interface Repoint {
  from: number;
  to: number;
}

interface Simulation {
  inserts: InsertTask[];
  repoints: Repoint[];
  skipped: number;
  missingOwners: string[];
}

/** AAD is a cross-module contract: `life.v1|<ownerSub>|tag|name`. */
function aad(owner: string): string {
  return `life.v1|${owner}|tag|name`;
}

function sentinel(ownerSub: string | null | undefined): string {
  return ownerSub ?? LEGACY_OWNER;
}

/** Owner + case-folded name collision key (case-insensitive per owner). */
function collisionKey(owner: string, name: string): string {
  return `${owner}\u0000${name.toLowerCase()}`;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

function indexExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
}

/** True when `table` carries a foreign key pointing at `target`. */
function hasForeignKeyTo(db: Database.Database, table: string, target: string): boolean {
  const rows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
    table: string;
  }>;
  return rows.some((row) => row.table === target);
}

/**
 * Resolve the two DB paths. `NOTE_DB_PATH`/`TAGS_DB_PATH` overrides resolve
 * against `INIT_CWD ?? cwd` (the `backfill-owner` convention); otherwise the
 * repo-root-anchored defaults are returned unchanged.
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ResolvedPaths {
  return {
    noteDbPath: resolveDbPath('NOTE_DB_PATH', DEFAULT_NOTE_DB_PATH, env),
    tagsDbPath: resolveDbPath('TAGS_DB_PATH', DEFAULT_TAGS_DB_PATH, env),
  };
}

function ensureRegistrySchema(db: Database.Database): string[] {
  const actions: string[] = [];
  if (!tableExists(db, 'tag')) {
    db.exec(TAG_DDL);
    actions.push('created tag table');
  }
  if (!indexExists(db, 'IDX_tag_owner_sub')) {
    db.exec(TAG_OWNER_INDEX_DDL);
    actions.push('created IDX_tag_owner_sub');
  }
  if (!tableExists(db, 'user_keys')) {
    db.exec(USER_KEYS_DDL);
    actions.push('created user_keys');
  }
  return actions;
}

/**
 * Step 2. Create `tag`/`user_keys` (+ the owner index) in `tags.db` when absent,
 * with DDL byte-equivalent to the registry entities so the next registry boot's
 * `synchronize` mutates nothing. Idempotent (existing tables → no actions).
 */
export function bootstrapRegistrySchema(tagsDbPath: string): string[] {
  mkdirSync(dirname(tagsDbPath), { recursive: true });
  const db = new Database(tagsDbPath);
  try {
    return ensureRegistrySchema(db);
  } finally {
    db.close();
  }
}

/** Load every registry DEK (unwrap under the registry master key). */
function loadRegistryKeys(db: Database.Database, tagsMasterKey: Buffer): Map<string, Buffer> {
  const deks = new Map<string, Buffer>();
  if (!tableExists(db, 'user_keys')) return deks;
  const rows = db
    .prepare('SELECT "sub","wrappedDek" FROM "user_keys"')
    .all() as Array<{ sub: string; wrappedDek: string }>;
  for (const row of rows) {
    deks.set(row.sub, unwrapDek(row.wrappedDek, tagsMasterKey));
  }
  return deks;
}

/** Unwrap the note DEK for one owner, memoized; `null` when none is filed. */
function noteDek(
  note: Database.Database,
  noteMasterKey: Buffer,
  cache: Map<string, Buffer | null>,
  owner: string,
): Buffer | null {
  if (cache.has(owner)) return cache.get(owner) ?? null;
  const row = tableExists(note, 'user_keys')
    ? (note
        .prepare('SELECT "wrappedDek" FROM "user_keys" WHERE "sub" = ?')
        .get(owner) as { wrappedDek: string } | undefined)
    : undefined;
  const dek = row ? unwrapDek(row.wrappedDek, noteMasterKey) : null;
  cache.set(owner, dek);
  return dek;
}

/** Dual-read one stored source value: decrypt an `enc.v1.` envelope, else pass through. */
function readPlaintext(
  note: Database.Database,
  noteMasterKey: Buffer,
  dekCache: Map<string, Buffer | null>,
  owner: string,
  id: number,
  stored: string,
): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const dek = noteDek(note, noteMasterKey, dekCache, owner);
  if (!dek) {
    throw new ImportRowError(id, owner, new Error('no note user_keys row for owner'));
  }
  try {
    return decryptField(dek, stored, aad(owner));
  } catch (err) {
    throw new ImportRowError(id, owner, err);
  }
}

/**
 * Read-only simulation of the import: source rows (dual-read), existing registry
 * rows (decrypted for collision detection), and the resulting insert/repoint
 * plan. Touches nothing — safe for `--dry-run`.
 */
function simulate(
  note: Database.Database,
  tags: Database.Database | null,
  noteMasterKey: Buffer,
  tagsMasterKey: Buffer,
): Simulation {
  const sourceRows = (
    tableExists(note, 'tag')
      ? note
          .prepare('SELECT "id","name","ownerSub" FROM "tag" ORDER BY "id" ASC')
          .all()
      : []
  ) as SourceTag[];

  const existingRows = (
    tags && tableExists(tags, 'tag')
      ? tags
          .prepare('SELECT "id","name","ownerSub" FROM "tag" ORDER BY "id" ASC')
          .all()
      : []
  ) as Array<{ id: number; name: string; ownerSub: string }>;

  const registryKeys = tags ? loadRegistryKeys(tags, tagsMasterKey) : new Map<string, Buffer>();
  const existingIds = new Set(existingRows.map((row) => row.id));

  const collisions = new Map<string, number>();
  for (const row of existingRows) {
    const dek = registryKeys.get(row.ownerSub);
    if (!dek) {
      throw new Error(`registry has no DEK for owner ${row.ownerSub}`);
    }
    const name = decryptField(dek, row.name, aad(row.ownerSub));
    const key = collisionKey(row.ownerSub, name);
    if (!collisions.has(key)) collisions.set(key, row.id);
  }

  const inserts: InsertTask[] = [];
  const repoints: Repoint[] = [];
  const noteDeks = new Map<string, Buffer | null>();
  let skipped = 0;

  for (const row of sourceRows) {
    if (existingIds.has(row.id)) {
      skipped += 1;
      continue;
    }
    const owner = sentinel(row.ownerSub);
    const plaintext = readPlaintext(note, noteMasterKey, noteDeks, owner, row.id, row.name);
    const key = collisionKey(owner, plaintext);
    const collision = collisions.get(key);
    if (collision !== undefined) {
      // Case-variant duplicate: merge onto the lowest id, repoint associations.
      repoints.push({ from: row.id, to: collision });
      continue;
    }
    inserts.push({ id: row.id, owner, plaintext });
    collisions.set(key, row.id);
  }

  const missingOwners = [...new Set(inserts.map((task) => task.owner))].filter(
    (owner) => !registryKeys.has(owner),
  );

  return { inserts, repoints, skipped, missingOwners };
}

/** Provision a fresh registry DEK for each missing owner in ONE transaction. */
function provisionRegistryKeys(
  tags: Database.Database,
  tagsMasterKey: Buffer,
  deks: Map<string, Buffer>,
  missingOwners: string[],
): void {
  if (missingOwners.length === 0) return;
  const createdAt = new Date().toISOString();
  tags.transaction(() => {
    for (const owner of missingOwners) {
      const dek = generateDek();
      tags
        .prepare(
          'INSERT INTO "user_keys" ("sub","wrappedDek","kekVersion","createdAt") VALUES (?,?,1,?)',
        )
        .run(owner, wrapDek(dek, tagsMasterKey), createdAt);
      deks.set(owner, dek);
    }
  })();
}

/**
 * Step 3 (+ the merge half of step 4). Copy `tag` rows id-preservingly into the
 * registry, re-encrypted under the registry DEKs; merge case-variant duplicates
 * onto the lowest id and repoint `note_tag` (deduping same-note duplicates
 * first). Batches are transactional; a poisoned row throws {@link ImportRowError}
 * (batch rolled back) with its id.
 */
export function importTags(
  noteDbPath: string,
  tagsDbPath: string,
  noteMasterKey: Buffer,
  tagsMasterKey: Buffer,
  options: ImportOptions = {},
): ImportCounts {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (batchSize < 1) throw new Error('batchSize must be >= 1');
  const encrypt = options.encryptField ?? encryptField;

  if (!existsSync(noteDbPath)) {
    throw new Error(`database does not exist: ${noteDbPath}`);
  }

  const note = new Database(noteDbPath);
  const tags = new Database(tagsDbPath);
  try {
    ensureRegistrySchema(tags);

    const { inserts, repoints, skipped, missingOwners } = simulate(
      note,
      tags,
      noteMasterKey,
      tagsMasterKey,
    );

    const registryKeys = loadRegistryKeys(tags, tagsMasterKey);
    provisionRegistryKeys(tags, tagsMasterKey, registryKeys, missingOwners);

    // Batched, transactional inserts. A failing row aborts its whole batch.
    for (let i = 0; i < inserts.length; i += batchSize) {
      const batch = inserts.slice(i, i + batchSize);
      tags.transaction(() => {
        for (const task of batch) {
          const dek = registryKeys.get(task.owner);
          if (!dek) {
            throw new ImportRowError(task.id, task.owner, new Error('no DEK for owner'));
          }
          let envelope: string;
          try {
            envelope = encrypt(dek, task.plaintext, aad(task.owner), {
              id: task.id,
              owner: task.owner,
            });
          } catch (err) {
            throw new ImportRowError(task.id, task.owner, err);
          }
          tags
            .prepare(
              'INSERT INTO "tag" ("id","name","ownerSub","version","createdAt") VALUES (?,?,?,0,?)',
            )
            .run(task.id, envelope, task.owner, new Date().toISOString());
        }
      })();
    }

    // Repoint associations. The legacy FK to `tag` may not contain the survivor
    // (a global registry id), so the window runs with FK enforcement off; the
    // dedupe precedes the update so the `(noteId, tagId)` PK cannot be violated.
    if (repoints.length > 0) {
      note.exec('PRAGMA foreign_keys = OFF');
      try {
        note.transaction(() => {
          for (const { from, to } of repoints) {
            note
              .prepare(
                'DELETE FROM "note_tag" WHERE "tagId" = ? AND "noteId" IN ' +
                  '(SELECT "noteId" FROM "note_tag" WHERE "tagId" = ?)',
              )
              .run(from, to);
            note.prepare('UPDATE "note_tag" SET "tagId" = ? WHERE "tagId" = ?').run(to, from);
          }
        })();
      } finally {
        note.exec('PRAGMA foreign_keys = ON');
      }
    }

    return {
      imported: inserts.length,
      skipped,
      merges: repoints.length,
      keysCreated: missingOwners.length,
    };
  } finally {
    tags.close();
    note.close();
  }
}

/**
 * Step 5. Schema surgery: rebuild `note_tag` without the FK to `tag` (keeping the
 * `noteId` PK + CASCADE FK), then drop the note DB's `tag` table. Idempotent:
 * absent `tag` table / already-rebuilt `note_tag` → skipped. `PRAGMA
 * foreign_keys = OFF` wraps the drop-and-rename and is always restored;
 * `PRAGMA foreign_key_check` must be clean before that happens.
 */
export function applySurgery(noteDbPath: string): string[] {
  const db = new Database(noteDbPath);
  try {
    const tagTableExists = tableExists(db, 'tag');
    const noteTagExists = tableExists(db, 'note_tag');
    const noteTagReferencesTag = noteTagExists && hasForeignKeyTo(db, 'note_tag', 'tag');

    if (!tagTableExists && !noteTagReferencesTag) {
      return ['skipped schema surgery (already migrated)'];
    }

    const actions: string[] = [];
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      if (noteTagReferencesTag) {
        db.exec('BEGIN');
        try {
          db.exec(NOTE_TAG_TEMP_DDL);
          db.exec(
            'INSERT INTO "temporary_note_tag" ("noteId","tagId") ' +
              'SELECT "noteId","tagId" FROM "note_tag"',
          );
          db.exec('DROP TABLE "note_tag"');
          db.exec('ALTER TABLE "temporary_note_tag" RENAME TO "note_tag"');
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        actions.push('rebuilt note_tag (removed FK to tag)');
      }
      if (tagTableExists) {
        db.exec('DROP TABLE "tag"');
        actions.push('dropped tag');
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `note_tag rebuild left ${violations.length} foreign-key violation(s); aborting`,
        );
      }
    } finally {
      // Enforcement is restored on every path, success or failure.
      db.exec('PRAGMA foreign_keys = ON');
    }
    return actions;
  } finally {
    db.close();
  }
}

/**
 * `--dry-run`. Counts what `applyImport` would do and writes nothing — no
 * registry creation, no DEK provisioning, no repoint, no surgery (asserted by
 * the byte-purity test).
 */
export function planImport(
  noteDbPath: string,
  tagsDbPath: string,
  noteMasterKey: Buffer,
  tagsMasterKey: Buffer,
): ImportReport {
  if (!existsSync(noteDbPath)) {
    throw new Error(`database does not exist: ${noteDbPath}`);
  }
  const note = new Database(noteDbPath, { readonly: true });
  const tags = existsSync(tagsDbPath) ? new Database(tagsDbPath, { readonly: true }) : null;
  try {
    const { inserts, repoints, skipped, missingOwners } = simulate(
      note,
      tags,
      noteMasterKey,
      tagsMasterKey,
    );
    return {
      mode: 'plan',
      imported: inserts.length,
      skipped,
      merges: repoints.length,
      keysCreated: missingOwners.length,
      errors: 0,
      noteBackupPath: null,
      tagsBackupPath: null,
      surgeryActions: [],
    };
  } finally {
    tags?.close();
    note.close();
  }
}

/**
 * The full apply flow: verified backups → registry bootstrap → import + merge →
 * schema surgery, in that order. Any failure throws; no destructive step runs
 * without the backups.
 */
export function applyImport(
  noteDbPath: string,
  tagsDbPath: string,
  noteMasterKey: Buffer,
  tagsMasterKey: Buffer,
  options: ImportOptions = {},
): ImportReport {
  // Step 1 — the shared `@life/db` snapshot primitive; aborts on any failure.
  const noteBackupPath = snapshotAndVerify(
    noteDbPath,
    uniqueSnapshotPath(noteDbPath, 'pre-import'),
  ).backupPath;
  const tagsBackupPath = existsSync(tagsDbPath)
    ? snapshotAndVerify(tagsDbPath, uniqueSnapshotPath(tagsDbPath, 'pre-import')).backupPath
    : null;
  bootstrapRegistrySchema(tagsDbPath); // Step 2 — DDL byte-equivalent to the entities
  const counts = importTags(noteDbPath, tagsDbPath, noteMasterKey, tagsMasterKey, options);
  const surgeryActions = applySurgery(noteDbPath); // Step 5 — last
  return {
    mode: 'apply',
    ...counts,
    errors: 0,
    noteBackupPath,
    tagsBackupPath,
    surgeryActions,
  };
}

/** One deterministic line both modes print (counts only, never content/id). */
export function formatImportReport(report: ImportReport): string {
  return (
    `import-tags [${report.mode}]: imported=${report.imported} ` +
    `skipped=${report.skipped} merges=${report.merges} ` +
    `keysCreated=${report.keysCreated} errors=${report.errors}`
  );
}

export interface ImportCliDeps {
  env?: NodeJS.ProcessEnv;
  print?: (line: string) => void;
  printError?: (line: string) => void;
  options?: ImportOptions;
}

/**
 * CLI body. Returns the exit code instead of terminating the process so the
 * entry stays honest under test. `--dry-run` plans; default applies.
 */
export function main(argv: string[] = process.argv.slice(2), deps: ImportCliDeps = {}): number {
  const env = deps.env ?? process.env;
  const print = deps.print ?? ((line: string) => console.log(line));
  const printError = deps.printError ?? ((line: string) => console.error(line));
  const dryRun = argv.includes('--dry-run');

  try {
    const { noteDbPath, tagsDbPath } = resolvePaths(env);
    const noteMasterKey = loadMasterKeyFromEnv(NOTE_MASTER_KEY_ENV);
    const tagsMasterKey = loadMasterKeyFromEnv(TAGS_MASTER_KEY_ENV);
    const report = dryRun
      ? planImport(noteDbPath, tagsDbPath, noteMasterKey, tagsMasterKey)
      : applyImport(noteDbPath, tagsDbPath, noteMasterKey, tagsMasterKey, deps.options);
    print(formatImportReport(report));
    return 0;
  } catch (err) {
    printError(`import-tags failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}
