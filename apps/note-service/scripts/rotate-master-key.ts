import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { Note } from '../src/notes/note.entity';
import { NoteTag } from '../src/notes/note-tag.entity';
import { UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../src/service-config';
import { resolveDbPath } from '../src/keys/db';
import { formatRotationReport, rotateMasterKeys } from '../src/keys/rotation';

export { resolveDbPath };

/**
 * `rotate-master-key` entry (`SPEC-notes-backfill` Sibling script + `D10`). Thin
 * CLI over the tested core in `src/keys/rotation.ts`; run via the workspace
 * convention:
 *
 *   npm run rotate-master-key -w @life/note-service
 *
 * Reads `NOTE_MASTER_KEY` (old) and `NOTE_MASTER_KEY_NEW` (new) from the
 * environment, re-wraps every `user_keys` row under the new key, and bumps
 * `kekVersion`. ZERO content rows are read or written — the command only ever
 * touches `user_keys`.
 *
 * Deploy Checklist (human-run) — the rotation step of
 * `docs/specs/SPEC-notes-backfill.md`:
 *
 * 1. Stop the stack (`docker compose down`).
 * 2. Backup: copy the note-service DB file to `<db>.pre-rotate-<date>` (rollback path).
 * 3. `NOTE_MASTER_KEY=<old> NOTE_MASTER_KEY_NEW=<new> npm run rotate-master-key -w @life/note-service`.
 * 4. Update `NOTE_MASTER_KEY` in the environment to `<new>`, boot (`docker compose up -d`), verify.
 * 5. Rollback if needed: stop, restore the backup file, boot with the old key.
 *
 * The DB path resolves through the shared `src/keys/db.ts` helper (identical to
 * `backfill-encrypt`): an explicit `NOTE_DB_PATH` override (resolved against
 * `INIT_CWD ?? cwd` like backfill-owner) wins; otherwise the default is anchored
 * at this package's own directory (`apps/note-service/data/life.db`), so the
 * documented repo-root command opens the right file regardless of cwd.
 *
 * Idempotent-ish and safe to re-run: rows already under the new key are reported
 * `skipped`, never corrupted. Any other failure exits non-zero.
 */

/** Env var holding the NEW master key. */
export const NEW_MASTER_KEY_ENV = 'NOTE_MASTER_KEY_NEW';

/** Mirror of `app.module.ts`'s better-sqlite3 DataSource, with `synchronize` off. */
export function createDataSource(dbPath: string): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: dbPath,
    entities: [Note, NoteTag, UserKeys],
    synchronize: false,
  });
}

export interface RotateCliDeps {
  /** Inject for testing; defaults to opening the mirror DataSource. */
  dataSource?: DataSource;
  env?: NodeJS.ProcessEnv;
  print?: (line: string) => void;
  printError?: (line: string) => void;
}

/**
 * CLI body. Returns 0 on success (including an all-skipped re-run), 1 on any
 * genuine failure — never terminating the process itself.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  deps: RotateCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const print = deps.print ?? ((line: string) => console.log(line));
  const printError = deps.printError ?? ((line: string) => console.error(line));

  const ownDataSource = deps.dataSource === undefined;
  let ds: DataSource | undefined = deps.dataSource;
  try {
    const oldMaster = loadMasterKeyFromEnv(MASTER_KEY_ENV);
    const newMaster = loadMasterKeyFromEnv(NEW_MASTER_KEY_ENV);
    if (!ds) {
      ds = createDataSource(resolveDbPath(env));
      await ds.initialize();
    }
    const report = await rotateMasterKeys(ds, oldMaster, newMaster);
    print(formatRotationReport(report));
    return 0;
  } catch (err) {
    printError(
      `rotate-master-key failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return 1;
  } finally {
    if (ownDataSource && ds?.isInitialized) {
      await ds.destroy();
    }
  }
}

/* istanbul ignore next — CLI entry, exercised manually at deploy time */
if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
