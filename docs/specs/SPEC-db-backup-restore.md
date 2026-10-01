# Spec: production SQLite backup & restore (`db:backup`, `db:restore`)

Traces to: `docs/intent/db-backup-restore.md` (CONFIRMED — D1–D11 are locked).
Implements: the operator commands that replace the manual
`cp apps/note-service/data/life.db backup/2026-10-01-031500/life.db` in
`docs/runbooks/production-deploy.md` Step 2.

## Objective

Give the operator two commands over one shared, verified snapshot mechanism:

- **`db:backup`** — snapshot all four production SQLite databases into
  `backup/2026-10-01T12-34-56-789Z/` (one directory per run, one file per
  database), each snapshot independently verified with `PRAGMA quick_check`.
  Read-only against its inputs, so it is safe with the stack up; a daily cron
  entry runs it unattended.
- **`db:restore`** — replace one or more live database files from a chosen
  snapshot directory, after first taking a verified pre-restore snapshot of every
  file it is about to overwrite. Refuses to run while the stack appears to be up;
  no interactive confirmation.

The snapshot logic is the mechanism already used by `import-tags` and
`backfill-owner`; this change gives it one home for all callers, rather than making
the backup/restore tooling a third copy.

## Locked-decision traceability

| # | Decision | Encoded in |
|---|---|---|
| D1 | Destination `backup/2026-10-01T12-34-56-789Z/` (one UTC-stamped directory per run; singular `backup/`, already in `.gitignore:12`) | Commands, Backup behavior |
| D2 | Four databases — `life.db`, `tags.db`, `todo.db`, `idp.db`; Redis out of scope | Scope, Cache Rules |
| D3 | No third copy of the snapshot logic — one shared home | Single home for the snapshot logic |
| D4 | Backup writes nothing to a source DB; works against a live database | Backup behavior |
| D5 | Restore refuses unless the stack is stopped; pre-restore snapshot first; no prompt | Restore behavior, Restore safety check |
| D6 | Keep newest 10 routine snapshots; pinned snapshots never auto-pruned | Retention |
| D7 | Routine vs deliberate is readable from the name and metadata | Modes and naming |
| D8 | Daily cron entry; crontab line documented for the human | Commands |
| D9 | `NOTE_DB_PATH`/`TAGS_DB_PATH`/`TODO_DB_PATH`/`IDP_DB_PATH` honoured; repo-anchored defaults | Scope, Backup behavior |
| D10 | A missing input database aborts before any snapshot is written | Backup behavior |
| D11 | Cron-clean: non-interactive, deterministic exit codes, no prompt | Commands, Backup behavior, Restore behavior |

## Scope

- **In scope (D2):** the four compose-host SQLite files and nothing else:
  - note — `apps/note-service/data/life.db` (compose bind mount `./apps/note-service/data:/data`)
  - tags — `apps/tags-service/data/tags.db` (bind mount `./apps/tags-service/data:/data`)
  - todo — `apps/todo-service/data/todo.db` (bind mount `./apps/todo-service/data:/data`)
  - idp — `apps/idp/data/idp.db` (bind mount `./apps/idp/data:/data`)
- **Out of scope (D2):** Redis (`redis-app`, `redis-idp`, `redis-note` — caches and a
  session store, never a source of truth per Contract 2); copies off this machine;
  the crontab install itself; any scheduled restore.
- **Not changed by this spec:** the service request paths, the cache layer, the UI,
  tokens, PWA constants.

## Tech Stack

- Node + `better-sqlite3` (already every service's driver), plain TypeScript steps —
  no Nest context, no new third-party dependency.
- `@life/shared`'s `resolveDbPath` for the four `*_DB_PATH` overrides (D9).
- One new workspace, `packages/db` (`@life/db`), the single home for the snapshot
  helper and the two operator CLIs (see below).
- Run via `ts-node` from a workspace script, matching
  `"cleanup-tags": "ts-node scripts/cleanup-tags.ts"` (`apps/tags-service/package.json:14`).

## Project Structure

```
packages/db/package.json                 # workspace @life/db; scripts build/typecheck/test:unit/db:backup/db:restore; inline jest config
packages/db/tsconfig.json                # tsc build config, mirroring packages/shared
packages/db/src/index.ts                 # re-exports the snapshot/verify helpers
packages/db/src/snapshot.ts              # THE snapshot implementation (one copy)
packages/db/src/paths.ts                 # repo-anchored defaults + resolvePaths via @life/shared
packages/db/src/backup.ts                # db:backup core + CLI body
packages/db/src/restore.ts               # db:restore core + CLI body
packages/db/scripts/backup.ts            # thin CLI entry (the cleanup-tags.ts pattern)
packages/db/scripts/restore.ts           # thin CLI entry
packages/db/test/snapshot.test.ts        # temp fixtures only
packages/db/test/backup.test.ts          # temp fixtures only
packages/db/test/restore.test.ts         # temp fixtures only; probe is an injected seam
```

Supporting edits (same change, no new files beyond the above):

- `package.json` (root): append `packages/db` to `workspaces` as the **last array
  entry**, after `packages/cache` — i.e. inside the `packages/*` block that follows the
  `apps/*` entries. **Rationale:** the array is already ordered apps-then-packages
  (`apps/note-service` … `apps/idp`, then `packages/shared` … `packages/cache`), and
  apps already import `@life/shared`, whose `package.json` resolves through `dist/`
  (`"main": "dist/index.js"`, `"types": "dist/index.d.ts"`) — so `packages/db`,
  another dist-resolved package, mirrors that placement and no existing entry moves.
  Then add
  `"db:backup": "npm run db:backup -w @life/db --"` and
  `"db:restore": "npm run db:restore -w @life/db --"` to `scripts`.
- `apps/tags-service/package.json` and `apps/note-service/package.json`: add
  `"@life/db": "*"` to `dependencies`; add
  a `^@life/db$` to `../../packages/db/src/index.ts` entry (resolved under the
  jest `rootDir`, the same form used for `@life/shared`) in the jest
  `moduleNameMapper` block.
- `apps/tags-service/src/tags/import.ts`: delete its local `uniqueBackupPath` and
  `snapshotAndVerify`; import the shared pair.
- `apps/tags-service/src/tags/cleanup.ts`: import `snapshotAndVerify` from `@life/db`
  instead of `./import`.
- `apps/note-service/scripts/backfill-owner.ts`: delete its local `uniqueBackupPath`
  and `snapshotAndVerify`; import the shared pair.
- `docs/runbooks/production-deploy.md` Step 2: replace the manual `cp` lines with
  `npm run db:backup -w @life/db -- --pin`.

## Single home for the snapshot logic (D3)

**Invariant: the repository contains exactly one implementation of
"snapshot a SQLite database and prove the copy".** Mechanical check:
`grep -rn "VACUUM INTO ?" packages apps --include='*.ts'` returns hits only under
`packages/db/src/snapshot.ts` after the three existing call sites are refactored.

The check is statement-scoped (the `?` matches the prepared-statement text
`source.prepare('VACUUM INTO ?')`), not the bare string `VACUUM INTO`, because the
bare string also matches the comment prose that documents the mechanism at
`apps/tags-service/src/tags/cleanup.ts:18`, `apps/tags-service/scripts/cleanup-tags.ts:17`,
`apps/tags-service/src/tags/import.ts:22,251,270`, and
`apps/note-service/scripts/backfill-owner.ts:15,112,128` — prose this change keeps.
Today the scoped command matches exactly the two function bodies this change deletes
(`apps/note-service/scripts/backfill-owner.ts:130` and
`apps/tags-service/src/tags/import.ts:271`), so it is currently red and turns green when
both are replaced by `@life/db`.

**Home: `packages/db`, package name `@life/db`.** It is a library workspace that
owns the generic snapshot/verify primitive plus the two operator CLIs built on it.
It is deliberately **not** `@life/shared`: `@life/shared` is imported by the
frontend (`apps/app/next.config.mjs:4` transpiles it into the Next bundle) and by
every service, and it is a dependency-free helper package; giving it
`better-sqlite3` would drag a native database driver into the browser build. The
new package has no frontend consumer.

`packages/db/package.json`:

```json
{
  "name": "@life/db",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test:unit": "jest",
    "db:backup": "ts-node scripts/backup.ts",
    "db:restore": "ts-node scripts/restore.ts"
  },
  "dependencies": {
    "@life/shared": "*",
    "better-sqlite3": "^11.8.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.13.9",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.6",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3"
  },
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": ".",
    "testRegex": "\\.test\\.ts$",
    "testPathIgnorePatterns": [
      "/node_modules/"
    ],
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "testEnvironment": "node"
  }
}
```

The `jest` block is inline in `package.json`, mirroring `packages/shared/package.json`
and `packages/cache/package.json` exactly: this repository carries jest configuration in
the manifest only — `find` across the repo (excluding `node_modules`) returns zero
`jest.config.*` files — so `npm run test:unit -w packages/db` runs only with this block.
`rootDir` stays `.` because the suites live in `packages/db/test/`, the same
`test/`-under-`rootDir` layout `packages/shared` uses.

The shared surface (`packages/db/src/snapshot.ts`, re-exported from `index.ts`):

```ts
export interface SnapshotOptions {
  /** Table names whose source row count must equal the copy's. */
  rowCountTables?: readonly string[];
}

export interface SnapshotResult {
  backupPath: string;
  quickCheck: 'ok';
  rowCounts: Record<string, number>;
}

/** UTC, millisecond resolution, filename-safe; never overwrites (suffix fallback). */
export function uniqueSnapshotPath(sourceDbPath: string, suffix: string): string;

/** Open source read-only, quick_check it, VACUUM INTO target, reopen target read-only, quick_check it. */
export function snapshotAndVerify(
  sourceDbPath: string,
  targetPath: string,
  options?: SnapshotOptions,
): SnapshotResult;

/** Open read-only and require PRAGMA quick_check = ok. Returns 'ok' or throws. */
export function verifyDatabase(dbPath: string): 'ok';
```

`snapshotAndVerify` creates `dirname(targetPath)` when missing, throws when the
source does not exist, when the source fails `quick_check`, when `VACUUM INTO`
refuses an existing target, when the target does not appear, when the target fails
`quick_check`, and when any `rowCountTables` count differs. The copy is issued as
`source.prepare('VACUUM INTO ?').run(targetPath)` — the statement-scoped form the D3
mechanical check greps for. `VACUUM INTO` reads the
source; the source handle is `readonly: true`, so the routine cannot mutate an
input (D4).

**How the two existing call sites come to use it (no fork):**

- `apps/tags-service/src/tags/import.ts` — delete `uniqueBackupPath` (currently
  ~lines 225-236) and `snapshotAndVerify` (~lines 256-292); import both names from
  `@life/db` and call
  `snapshotAndVerify(dbPath, uniqueSnapshotPath(dbPath, 'pre-import'))`.
- `apps/tags-service/src/tags/cleanup.ts` — currently
  `import { snapshotAndVerify } from './import'` (line 5); change to
  `import { snapshotAndVerify, uniqueSnapshotPath } from '@life/db'` and call
  `snapshotAndVerify(paths.tagsDbPath, uniqueSnapshotPath(paths.tagsDbPath, 'pre-cleanup'))`.
- `apps/note-service/scripts/backfill-owner.ts` — delete `uniqueBackupPath`
  (~lines 97-108) and `snapshotAndVerify` (~lines 118-155); import the shared pair
  and call
  `snapshotAndVerify(noteDbPath, uniqueSnapshotPath(noteDbPath, 'bak'), { rowCountTables: ['note'] })`
  (this preserves the existing `note` row-count match), mapping the returned
  `rowCounts.note` onto the script's `BackupResult.noteCount`.

The helper is a generic primitive under `packages/db`; `@life/db` is the one
place a future service would import it from.

## Commands

All commands run from the repository root. Each is complete and copy-pasteable.

Backup, routine (the cron form):

```bash
npm run db:backup -w @life/db
```

Backup, deliberate and pinned (e.g. before the runbook migration):

```bash
npm run db:backup -w @life/db -- --pin
```

Backup a subset (only the selected databases are required to exist):

```bash
npm run db:backup -w @life/db -- --only life,idp
```

Restore every database present in a snapshot directory:

```bash
npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
```

Restore a single database from a pinned snapshot:

```bash
npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only idp
```

The cron line (D8) — **documented for the human to install; installing machine-level
config is a hard line and is not done by the agent.** Adjust the checkout path if the
host copy differs from `/home/night/WebstormProjects/personal-life`:

```cron
0 3 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
```

The human installs it with `crontab -e` (paste the line above).

## Backup behavior (D1, D2, D4, D9, D10, D11)

1. Resolve the four paths (D9): `NOTE_DB_PATH`, `TAGS_DB_PATH`, `TODO_DB_PATH`,
   `IDP_DB_PATH`, each through `resolveDbPath(envName, defaultPath)` from
   `@life/shared`. Defaults are repo-anchored from `packages/db/src/paths.ts`'s own
   directory — `join(__dirname, '..', '..', '..', 'apps', 'note-service', 'data', 'life.db')`,
   `join(__dirname, '..', '..', '..', 'apps', 'tags-service', 'data', 'tags.db')`,
   `join(__dirname, '..', '..', '..', 'apps', 'todo-service', 'data', 'todo.db')`,
   `join(__dirname, '..', '..', '..', 'apps', 'idp', 'data', 'idp.db')` — so the
   documented repo-root command opens the right files regardless of `npm -w` setting
   the script cwd to the workspace (`packages/shared/src/db-path.ts:24-35`).
2. Select the set: default all four, or the comma-separated `--only` list.
   Unknown names are rejected before anything is written.
3. **Fail closed (D10):** check `existsSync` for every database in the selected set
   before creating the snapshot directory or writing any file. If any is missing,
   print each missing path and exit 1 — nothing is written.
4. Compute the run stamp once:
   `new Date().toISOString().replace(/[:.]/g, '-')` (for example
   `2026-10-01T12-34-56-789Z`). The `backup/` root resolves against
   `INIT_CWD ?? cwd` (the same convention `resolveDbPath` uses for relative
   overrides), so `npm run db:backup -w @life/db` invoked from the repository root
   writes the repository-root `backup/` even though npm sets the script cwd to
   `packages/db`. Destination directory is `backup/2026-10-01T12-34-56-789Z/` (D1).
   A `-pinned` suffix is appended when `--pin` is given (D7).
5. For each selected database, call
   `snapshotAndVerify(sourcePath, join(destination, basename(sourcePath)))`. Each
   target is a verified `VACUUM INTO` copy that passes `PRAGMA quick_check`
   (D3). Sources are opened read-only, so the backup writes nothing to them and is
   safe against a live, in-use database (D4).
6. Write `manifest.json` into the destination directory recording `mode`, the UTC
   `createdAt`, `pinned`, and one entry per database (`name`, `file`, `source`,
   `bytes`, `quickCheck`). For `--pin`, also write an empty `PINNED` marker file.
7. Apply retention (below).
8. Print one line per snapshot (`db:backup [routine] life.db -> backup/2026-10-01T12-34-56-789Z/life.db quick_check=ok`) and exit 0.

No prompt, no stdin read (D11). A run never overwrites an existing snapshot
directory: `VACUUM INTO` refuses an existing target and the run stamp has
millisecond resolution.

## Retention (D6)

After a **successful routine backup**, prune snapshots so that the newest 10
**routine** snapshots are kept and older routine snapshots are deleted.

- Candidate = a direct child of `backup/` whose `manifest.json` has
  `"mode": "routine"` and `"pinned": false`.
- Never pruned: any directory named with a `-pinned` suffix, any directory
  containing `PINNED`, any `manifest.json` with `"mode": "deliberate"` or
  `"mode": "pre-restore"`, and any pre-existing directory without a readable
  `manifest.json` (fail-safe: unknown provenance is left alone).
- Ordering is by directory name; the stamp is ISO-8601 with `:` and `.` replaced by
  `-`, so lexicographic order is chronological order.
- Pruning is best-effort: a delete failure is logged as a warning but does not
  change the backup's exit code. The snapshot itself has already succeeded and is
  verified.
- Pinned snapshots are never auto-pruned by any command (D6).

## Modes and naming (D7)

| Mode | Produced by | Directory name | `manifest.json` | Marker |
|---|---|---|---|---|
| routine | `db:backup` (no flags) | `backup/2026-10-01T12-34-56-789Z/` | `"mode": "routine"` | none |
| deliberate | `db:backup --pin` | `backup/2026-10-01T12-34-56-789Z-pinned/` | `"mode": "deliberate"`, `"pinned": true` | empty `PINNED` |
| pre-restore | `db:restore` | `backup/pre-restore-2026-10-01T12-34-56-789Z/` | `"mode": "pre-restore"`, `"pinned": true` | empty `PINNED` |

The name alone distinguishes routine from deliberate/pinned; `manifest.json` is the
metadata record.

## Restore behavior (D5, D11)

1. Parse `--from` (required; a directory under `backup/`, resolved against
   `INIT_CWD ?? cwd` like the backup destination) and `--only`
   (optional, comma-separated subset of `life,tags,todo,idp`; default = every
   database file present in the snapshot directory). Missing `--from`, an unknown
   `--only` name, or a `--from` directory that does not exist exits 1 before any
   write.
2. **Preconditions, checked before any write:**
   - Every selected snapshot file must exist; otherwise exit 1.
   - Every selected snapshot file must pass `verifyDatabase` (`PRAGMA quick_check`
     on the chosen snapshot, decided here: yes, verify the input before replacing
     anything). A failure exits 1 and nothing is replaced.
   - The stack must appear stopped (next section). If it appears up, or its state
     cannot be determined, exit 2 and replace nothing.
3. For each selected database, in this order:
   1. If the live target file exists, take a verified pre-restore snapshot (D5):
      `snapshotAndVerify(targetPath, join('backup', `pre-restore-${stamp}`, basename(targetPath)))`.
      A pre-snapshot failure aborts the whole restore **before that target is
      touched** (no silent data loss, below). If the target does not exist there is
      no data to preserve; skip its pre-snapshot and record `preRestore: null`.
   2. Remove the stale `targetPath-wal` and `targetPath-shm` siblings if present.
   3. Copy the verified snapshot file over `targetPath`.
   4. Open `targetPath` read-only and require `PRAGMA quick_check` = `ok`; a failure
      exits 1 (the pre-restore snapshot in step 3.1 is the recovery path).
4. Write `manifest.json` into the pre-restore directory (mode `pre-restore`,
   `pinned: true`, one entry per replaced file).
5. Print one line per restored database and exit 0. No prompt, no stdin read (D11).

Restoring `idp.db` can revert user accounts (D2) — the pre-restore snapshot is the
undo path and is pinned so retention never deletes it.

## Restore safety check — "is the stack stopped" (D5)

The check is read-only and never kills or stops anything.

- The compose stack publishes exactly two host-loopback ports: `app` on
  `127.0.0.1:3002` and `idp` on `127.0.0.1:3003` (`compose.yaml:150-153`, `:201-202`).
  `note-service`, `tags-service`, and `todo-service` publish no host ports and
  cannot be probed from the host.
- For each of `3002` and `3003`, open a plain TCP connection to `127.0.0.1:port`
  with a one-second timeout:
  - connection accepted → the stack is up;
  - `ECONNREFUSED` → that port is down;
  - any other error or a timeout → the state is unknown.
- If any port is up, or any probe is unknown, refuse: print the reason and exit 2
  without touching a database. Only "all probes refused" is treated as stopped.
- The documented procedure remains `docker compose down` (`docs/runbooks/production-deploy.md:65`),
  which stops every service; the probe is the guard against restoring on a running
  stack. Because `note-service`/`tags-service`/`todo-service` are unpublished on the
  host, the probe cannot observe a state where only `app`/`idp` are down — this is the
  accepted, fail-closed state recorded in the Decisions section below.

## No silent data loss (D5)

Restore replaces a live database. Therefore:

- The pre-restore snapshot is **mandatory** for every target that already exists and
  is taken and verified (`PRAGMA quick_check` = `ok`) **before** that target is
  removed or overwritten. If it cannot be taken or does not verify, the restore
  aborts and the live file is left untouched.
- The chosen snapshot is itself verified before it is used, so a corrupt backup
  cannot overwrite a live database.
- If the copy over the live file or the post-copy `quick_check` fails, the verified
  pre-restore snapshot is the documented recovery path and is pinned (never
  auto-pruned).
- Restore never deletes a snapshot and never prunes; retention runs only inside
  `db:backup`.

## Cache Rules (AGENTS.md Contract 2 — recorded deviation)

This tooling **never touches Redis**. It does not import or connect to a cache and
has no `getThrough` read path: it reads and writes SQLite files directly, with the
stack stopped for restore and read-only for backup.

- **Cached shapes / keys / invalidation / failure mode:** not applicable — there is
  no cache layer in this tooling.
- **Why the deviation is correct rather than a shortcut:** Contract 2 makes Redis a
  cache and never a source of truth, and the operator commands must work with the
  stack stopped (restore, D5). A stopped stack means no service is running to bump
  a per-owner generation counter; the caches that survive in Docker named volumes
  are either AOF session state (`redis-app`, out of scope per D2) or unpersisted
  read-through caches (`redis-idp`, `redis-note` — `--save "" --appendonly no`,
  `compose.yaml:238-254`, `:266-281`) whose 60-second TTL backstop
  (`SPEC-tags-service.md:66`) bounds any residual staleness after restart.
- **Mechanical check:** `grep -rni "redis" packages/db/src` returns zero hits.

## Code Style

Plain sequential steps with explicit aborts; a CLI body that returns an exit code
instead of terminating the process, matching `backfill-owner.ts:436-451` and
`cleanup.ts:239-256`:

```ts
export function main(argv: string[] = process.argv.slice(2), env = process.env): number {
  try {
    const paths = resolvePaths(env);                 // D9
    assertSelectedExist(paths);                      // D10 — before any write
    const destination = prepareDestination(argv);    // D1 / D7
    for (const db of paths.selected) {
      snapshotAndVerify(db.source, join(destination, basename(db.source)));
    }
    writeManifest(destination);
    pruneRoutineSnapshots();                         // D6 — best-effort
    return 0;
  } catch (err) {
    console.error(`db:backup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}
```

- One responsibility per module; `snapshot.ts` owns the SQLite mechanics, `paths.ts`
  owns resolution, `backup.ts`/`restore.ts` own orchestration.
- No `process.exit`, no `readline`, no prompts; deterministic stdout lines and exit
  codes.
- Types at every module boundary (`SnapshotResult`, `manifest` shape, resolved-paths
  shape); no `any`.

## Testing Strategy

Unit tests only, against **temp fixture databases** created under the OS temp
directory — never anything under `apps/*/data/` (a hard line). The restore
stack-stopped probe is an injected seam (a function argument) so tests never touch a
real port.

Per the Project Profile, from the owning workspace:

```bash
npm run typecheck -w packages/db
npm run test:unit -w packages/db -- test/snapshot.test.ts
npm run test:unit -w packages/db -- test/backup.test.ts
npm run test:unit -w packages/db -- test/restore.test.ts
```

Cover:

- **snapshot:** source opened read-only (a fixture's bytes and mtime are unchanged);
  source and copy both pass `quick_check`; `uniqueSnapshotPath` never returns an
  existing path; `VACUUM INTO` refuses an existing target; `rowCountTables` mismatch
  throws; a missing source throws.
- **backup:** a missing selected database aborts before the destination directory is
  created (D10); all four fixtures produce one verified file each plus
  `manifest.json`; a run is routine and `--pin` is deliberate, distinguishable from
  name and manifest (D7); retention keeps the newest 10 routine snapshots, prunes the
  rest, and never prunes a pinned or pre-existing-manifest-less directory (D6); the
  command reads sources only (D4); `--only` requires only the selected files.
- **restore:** refuses and replaces nothing when the injected probe reports up or
  unknown (D5, exit 2); verifies the chosen snapshot before use; takes and verifies a
  pre-restore snapshot before replacing and that snapshot restores the prior state;
  aborts before touch when the pre-snapshot fails; replaces the live file and the
  result passes `quick_check`; a missing `--from` file exits 1; `--only` restores the
  subset.
- **CLI:** run with stdin closed → no prompt and no hang (D11); exit codes are
  deterministic across repeated identical runs.
- **convergence:** the refactored `import-tags`, `cleanup-tags`, and `backfill-owner`
  suites stay green after switching to the shared helper.

## Frozen surfaces (human-owned — this change touches none)

- The e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`).
- Token values (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md` value table).
- PWA constants (`public/manifest.json`, `viewport.themeColor`).

This change adds a backend/operator workspace and edits runbook and package metadata
only; no UI code, no selectors, no tokens, no PWA constants.

## Boundaries

- **Always:** resolve the four `*_DB_PATH` overrides through `@life/shared` (D9);
  fail closed on a missing selected input before any write (D10); open every source
  read-only (D4); verify both source and copy with `PRAGMA quick_check` (D3); take and
  verify a pre-restore snapshot before overwriting a live file (D5); keep newest 10
  routine snapshots and never auto-prune pinned ones (D6); be non-interactive with
  deterministic exit codes (D11); keep exactly one snapshot implementation (D3).
- **Ask first:** changing the destination away from `backup/` (D1); changing the
  retention count (D6); changing the scope beyond the four databases (D2); adding a
  host-port probe beyond `3002`/`3003`.
- **Never:** write to a source database during backup; touch Redis (Cache Rules);
  kill, stop, or restart a service from the script; install the crontab (the human
  does, D8); run against `apps/*/data/` from tests or agents; add a second copy of
  the snapshot logic; prompt interactively or read stdin; change the e2e selector
  surface, token values, or PWA constants.

## Success Criteria

1. `npm run db:backup -w @life/db` writes
   `backup/2026-10-01T12-34-56-789Z/` with one `PRAGMA quick_check`-clean file per
   selected database plus `manifest.json`, and exits 0 (D1, D3, D4).
2. `npm run db:backup -w @life/db -- --pin` writes
   `backup/2026-10-01T12-34-56-789Z-pinned/` with a `PINNED` marker, and a routine
   run is distinguishable from it by name and `manifest.json` alone (D7).
3. After an 11th routine run, exactly the newest 10 routine snapshots remain and
   every pinned snapshot is untouched (D6).
4. With any selected database absent, backup exits non-zero and no destination
   directory or file is created (D10).
5. `npm run db:restore -w @life/db -- --from backup/2026-10-01T12-34-56-789Z` exits 2 and replaces nothing
   while the injected/real probe reports `3002` or `3003` up (D5); with both refused,
   it replaces the selected files, each verified by `quick_check`, after writing a
   verified `backup/pre-restore-2026-10-01T12-34-56-789Z/` snapshot (D5, no silent
   data loss).
6. Restoring the pre-restore snapshot returns the database to its prior state (the
   undo proof).
7. `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'` matches only
   `packages/db/src/snapshot.ts`; `import-tags`, `cleanup-tags`, and `backfill-owner`
   suites are green against the shared helper (D3).
8. Every command exits 0 on success and a documented non-zero code on failure with
   stdin closed; no prompt appears (D11).
9. `npm run typecheck -w packages/db` and the three unit suites are green.

## Decisions taken during Specify

1. **The stack-stopped probe stays the fail-closed two-port probe (`3002`/`3003`); it
   does NOT parse `docker compose ps`.** Rationale: the restore script must never spawn
   Docker (Boundaries: never kill/stop/restart a service from the script), so shelling
   out to `docker compose ps` is out; its output is format- and locale-fragile to parse;
   and the probe's contract is already fail-closed — any state it cannot verify refuses
   with exit 2, so an unverifiable state is handled by refusal, not by a weaker probe.
   The documented procedure remains `docker compose down`
   (`docs/runbooks/production-deploy.md:65`). Recorded honestly: `note-service`,
   `tags-service`, and `todo-service` publish no host port, so a partial-down state
   (only `app`/`idp` stopped) is unobservable by design; that is accepted because
   fail-closed makes the unobservable state safe — the probe refuses rather than
   proceeding.
2. **The cron line stays as prose in this spec; no `backup/cron.example` file is
   created.** Rationale: `backup/` is gitignored (`.gitignore:12`), so a file placed
   there would never be versioned and would sit inside the directory retention prunes —
   a worse home for a line the human must keep. The sentence already telling the human
   to adjust the checkout path (`/home/night/WebstormProjects/personal-life`) is kept
   as written, and the human installs the line with `crontab -e` (D8).
