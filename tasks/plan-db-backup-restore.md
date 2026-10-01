# Implementation Plan: production SQLite backup & restore (`db:backup`, `db:restore`)

Source of record: `docs/specs/SPEC-db-backup-restore.md` (its decisions are locked);
intent: `docs/intent/db-backup-restore.md` (D1–D11 CONFIRMED). This plan adds no spec
text, no task-tracker entries, and no code — it is the execution plan only.

Process: global protocol §3 (testing), §4/§5 (delegation + mandatory task template),
§6 (plan validation gate), §7 (review + five-lane gate). Every task below is in §5 form
and carries acceptance criteria, an exact verification command, dependencies, files, and
size. Test runs are targeted named files only (max 2 executions per suite); no full suite;
**no E2E and no Playwright anywhere** — no browser surface is touched, no `*.spec.ts`
Playwright spec is created, removed, or modified. The only `.e2e-spec.ts` referenced is the
pre-existing note-service jest suite `test/owner-backfill.e2e-spec.ts`, which runs through
`npm run test:unit` against temp fixtures and is not a browser test.

## 1. Overview

This change turns the runbook's manual `cp apps/note-service/data/life.db
backup/2026-10-01-031500/` into two operator commands over one shared, verified snapshot
mechanism. A new library workspace `packages/db` (`@life/db`) owns the single `VACUUM
INTO` + `PRAGMA quick_check` primitive; `db:backup` snapshots the four compose-host SQLite
databases (`life.db`, `tags.db`, `todo.db`, `idp.db`) into a UTC-stamped directory such as
`backup/2026-10-01T12-34-56-789Z/` read-only
(so it is safe with the stack up and under cron), and `db:restore` replaces selected live
databases from a chosen snapshot after refusing unless the stack is stopped and after
taking a verified, pinned pre-restore snapshot of every file it overwrites. The two
existing call sites (`import-tags`, `backfill-owner`, plus `cleanup-tags`) are refactored
onto the shared helper so the repository keeps exactly one snapshot implementation, and
the runbook's Step 2 uses the new command.

## 2. Architecture decisions (locked — cited, not re-opened)

| Decision | Spec anchor |
|---|---|
| Single snapshot home is a new workspace `packages/db` / `@life/db` (a library workspace: primitive + two operator CLIs), **not** `@life/shared` (which the frontend transpiles and must stay driver-free). No third copy. | `SPEC-db-backup-restore.md` "Single home for the snapshot logic (D3)", lines 108–190 |
| `db:backup` is read-only against its inputs (source opened `readonly: true`, `VACUUM INTO`), so it is safe against a live, in-use database and under cron. | spec "Backup behavior (D1, D2, D4, D9, D10, D11)" step 5, lines 314–318; D4 |
| `db:restore` refuses unless the stack appears stopped (fail-closed two-port probe `3002`/`3003`; up OR unknown → exit 2), and takes a mandatory, verified, pinned pre-restore snapshot before any overwrite. No interactive prompt. | spec "Restore behavior (D5, D11)" lines 358–388; "Restore safety check" lines 390–409; "No silent data loss (D5)" lines 411–425; "Decisions taken during Specify" 1, lines 570–581 |
| Retention keeps the newest 10 routine snapshots and prunes older ones; pinned / deliberate / pre-restore / manifest-less directories are never pruned; pruning is best-effort and never changes the backup exit code. | spec "Retention (D6)" lines 329–345 |
| Modes and naming: routine `backup/2026-10-01T12-34-56-789Z/`, deliberate `backup/2026-10-01T12-34-56-789Z-pinned/` with a `PINNED` marker, pre-restore `backup/pre-restore-2026-10-01T12-34-56-789Z/` with a `PINNED` marker; name + `manifest.json` are the discriminator. | spec "Modes and naming (D7)" lines 347–356 |
| Four databases only; per-service `NOTE_DB_PATH`/`TAGS_DB_PATH`/`TODO_DB_PATH`/`IDP_DB_PATH` overrides resolved through `@life/shared`'s `resolveDbPath`, with repo-anchored defaults; Redis out of scope. | spec "Scope" lines 42–53; "Backup behavior" step 1, lines 292–300; D2, D9 |
| Fail closed: a missing selected input aborts before any file or directory is written. | spec "Backup behavior" step 3, lines 303–305; D10 |
| Non-interactive: no prompt, no stdin read, deterministic exit codes (`backup` 0/1; `restore` 0/1/2). | spec "Commands" lines 246–288; D11 |
| The crontab line is documented for the human to install; installing machine-level config is a hard line and is not done by the agent. | spec "Commands" lines 280–288; D8 |

## 3. Ground truth (verified by reconnaissance)

- The scoped no-fork check today returns exactly two statement hits:
  `apps/note-service/scripts/backfill-owner.ts:130` and
  `apps/tags-service/src/tags/import.ts:271`. `cleanup.ts:5` imports `snapshotAndVerify`
  from `./import`; there are no other call sites.
- Existing helper signatures to replace: `import.ts:225 uniqueBackupPath(dbPath)` /
  `import.ts:256 snapshotAndVerify(dbPath): string`; `backfill-owner.ts:97
  uniqueBackupPath(noteDbPath)` / `backfill-owner.ts:118 snapshotAndVerify(noteDbPath):
  BackupResult`.
- Tests that pin behavior this change touches: `apps/tags-service/test/cleanup-tags.test.ts`
  asserts the snapshot suffix `.pre-import-` (line 349) and filters backups by
  `.pre-import-` (line 176); `apps/tags-service/test/import-tags.test.ts:509` asserts
  `.pre-import-`; `apps/note-service/test/owner-backfill.e2e-spec.ts:217,548` assert
  `.bak-`.
- `@life/shared` resolves through `packages/shared/dist` (`"main": "dist/index.js"`,
  `"types": "dist/index.d.ts"`); `packages/shared/dist` is present and `dist/` is
  gitignored (`.gitignore:2`). The new `@life/db` resolves the same way for `tsc`; jest
  uses `moduleNameMapper`.
- `apps/tags-service/tsconfig.json` and `apps/note-service/tsconfig.json` both
  `include: ["src/**/*"]`, so `scripts/**` is compiled only by ts-jest when a suite
  imports the CLI (the `cleanup-tags.ts` precedent). `packages/db/tsconfig.json` mirrors
  `packages/shared` (`outDir: dist`, `rootDir: src`, `include: ["src/**/*"]`).
- The repo carries jest configuration only in each `package.json` (no `jest.config.*`).
- Lessons read (`docs/lessons/`): 0003, 0005, 0006, 0008, 0009, 0010. None contradicts a
  step here. 0006/0009 reinforce "no fork, one owner"; 0010 means a validation FAIL is
  repaired by a delegated subagent, not by the Tech Lead editing this plan.

## 4. Task list, phases, checkpoints

Ordered by dependency. Checkpoints are gates between phases, not implementation tasks.

### Phase 1 — Workspace skeleton
- [ ] **T1** `@life/db` workspace skeleton (package.json, tsconfig.json, index barrel,
  root `workspaces` entry).

### Checkpoint 1 (after T1, not a task)
- [ ] `npm run typecheck -w packages/db` exits 0.
- [ ] `grep -rn "@life/db" apps --include='*.ts'` → zero hits (no consumer yet).

### Phase 2 — Shared primitive
- [ ] **T2** `packages/db/src/paths.ts` (four repo-anchored defaults + `resolvePaths` +
  `selectPaths`) with its cases in `packages/db/test/backup.test.ts`.
- [ ] **T3** `packages/db/src/snapshot.ts` (`uniqueSnapshotPath`, `snapshotAndVerify`,
  `verifyDatabase`) exactly per the spec interface block; `index.ts` re-export; suite
  `packages/db/test/snapshot.test.ts`.

### Checkpoint 2 (after T3, not a task)
- [ ] `npm run test:unit -w packages/db -- test/snapshot.test.ts` green.
- [ ] `npm run test:unit -w packages/db -- test/backup.test.ts` green (paths block only).
- [ ] `npm run typecheck -w packages/db` exits 0.

### Phase 3 — Refactor the existing call sites (the D3 no-fork gate)
- [ ] **T4** tags-service consumes `@life/db` (`import.ts`, `cleanup.ts`, package.json,
  the one suffix assertion in `cleanup-tags.test.ts`).
- [ ] **T5** note-service `backfill-owner.ts` consumes `@life/db` (script + package.json).

### Checkpoint 3 (after T5, not a task)
- [ ] D3 check: `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'` matches only
  `packages/db/src/snapshot.ts` (see §6 for before/after).
- [ ] `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` green.
- [ ] `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts` green.
- [ ] `npm run test:unit -w @life/note-service -- test/owner-backfill.e2e-spec.ts` green.

### Phase 4 — Operator CLIs
- [ ] **T6** `packages/db/src/backup.ts` + `scripts/backup.ts` + `test/backup.test.ts`
  (backup cases) + the `db:backup` workspace script entry.
- [ ] **T7** `packages/db/src/restore.ts` + `scripts/restore.ts` + `test/restore.test.ts`
  + the `db:restore` workspace script entry.

### Checkpoint 4 (after T7, not a task)
- [ ] `npm run test:unit -w packages/db -- test/backup.test.ts` green.
- [ ] `npm run test:unit -w packages/db -- test/restore.test.ts` green.
- [ ] `npm run typecheck -w packages/db` exits 0.

### Phase 5 — Wiring and runbook
- [ ] **T8** root `package.json` `db:backup`/`db:restore` scripts; runbook Step 2 uses
  the new command in place of the manual `cp`.

### Checkpoint 5 (after T8, not a task)
- [ ] `grep -n "db:backup\|db:restore" package.json` shows both root scripts.
- [ ] `grep -n "cp apps/\|mkdir -p backup/" docs/runbooks/production-deploy.md` → zero hits.

### Phase 6 — Final verification
- [ ] **T9** mechanical checks + the mandated targeted suites (no code change).

## 5. Tasks in §5 template form

---

### T1 — `@life/db` workspace skeleton

**Description.** Create the `packages/db` workspace so later tasks have a home: its
manifest (with the inline jest block copied from `packages/shared/package.json`), a
`tsconfig.json` mirroring `packages/shared`, an empty barrel `src/index.ts`, and the
`packages/db` entry appended as the last element of the root `workspaces` array after
`packages/cache`. Nothing imports `@life/db` yet.

**Acceptance criteria.**
- `packages/db/package.json` names the package `@life/db`, is private, points
  `main`/`types` at `dist/`, and its `jest` block is byte-identical to
  `packages/shared/package.json`'s `jest` block.
- `packages/db/tsconfig.json` extends `../../tsconfig.base.json` with `outDir: dist`,
  `rootDir: src`, `include: ["src/**/*"]` (mirrors `packages/shared/tsconfig.json`).
- `packages/db/src/index.ts` is a valid module barrel (initially `export {};`); T3 adds
  `export * from './snapshot';`.
- Root `package.json` `workspaces` has `packages/db` as the last entry, after
  `packages/cache`; no existing entry moves.
- The package depends on `@life/shared` and `better-sqlite3`, and declares the dev
  toolchain (`@types/better-sqlite3`, `@types/jest`, `@types/node`, `jest`, `ts-jest`,
  `ts-node`, `typescript`) exactly as the spec's manifest block (lines 134–179).
- `npm run typecheck -w packages/db` exits 0.

**Setup (prerequisite, not a profile verification command).**
- `npm install` (from the repo root; links the new workspace into
  `node_modules/@life/db`, installs its dependencies, and updates `package-lock.json`).

**Verification (exact profile commands).**
- `npm run typecheck -w packages/db`
- `grep -rn "@life/db" apps --include='*.ts'` → zero hits.

**Dependencies.** None.

**Files likely touched.** `packages/db/package.json` (new), `packages/db/tsconfig.json`
(new), `packages/db/src/index.ts` (new), `package.json` (root — `workspaces` entry),
`package-lock.json` (via `npm install`).

**Size.** Small (5 files incl. the lockfile). The `db:backup`/`db:restore` script entries
from the spec manifest are added by T6/T7 with the files they invoke, so T1 leaves no
dangling script entry; the final manifest equals the spec block.

---

### T2 — `packages/db/src/paths.ts` (repo-anchored defaults + resolution)

**Description.** Implement the package's path-resolution module: the four repo-anchored
defaults computed from this file's own directory, `resolvePaths(env)` returning the four
entries resolved through `@life/shared`'s `resolveDbPath` (D9), and `selectPaths` for the
CLIs' `--only` subset (rejecting unknown names). Cases open
`packages/db/test/backup.test.ts`.

**Acceptance criteria.**
- `DEFAULT_NOTE_DB_PATH`, `DEFAULT_TAGS_DB_PATH`, `DEFAULT_TODO_DB_PATH`,
  `DEFAULT_IDP_DB_PATH` are repo-root anchored, concretely:
  `join(__dirname, '..', '..', '..', 'apps', 'note-service', 'data', 'life.db')`,
  `join(__dirname, '..', '..', '..', 'apps', 'tags-service', 'data', 'tags.db')`,
  `join(__dirname, '..', '..', '..', 'apps', 'todo-service', 'data', 'todo.db')`,
  `join(__dirname, '..', '..', '..', 'apps', 'idp', 'data', 'idp.db')` — resolved from both
  `packages/db/src` and `packages/db/dist`.
- `packages/db/src/paths.ts` declares and exports
  `export type DatabaseName = 'life' | 'tags' | 'todo' | 'idp';`; the four repo-anchored
  defaults and `resolvePaths` are keyed by it.
- `packages/db/src/index.ts` adds the re-export (`export * from './paths';`), so
  `DatabaseName` is importable from `@life/db` as well as from `./paths`; this is the
  package's shared surface.
- `resolvePaths(env)` returns four ordered entries `{ name: DatabaseName; envName: string;
  source: string }`, one per database, each source produced by `resolveDbPath(envName,
  defaultPath, env)` with `envName` equal to `NOTE_DB_PATH`, `TAGS_DB_PATH`, `TODO_DB_PATH`,
  `IDP_DB_PATH` respectively.
- An env override resolves against `INIT_CWD ?? cwd`; an absent override yields the
  default unchanged.
- `selectPaths(paths, only)` returns the full list when `only` is undefined and the named
  subset otherwise; an unknown name throws an `Error` whose message contains
  `unknown database name`.
- Every assertion is a string comparison; nothing under `apps/*/data/**` is opened.

**Verification (exact).**
- `npm run test:unit -w packages/db -- test/backup.test.ts`
- `npm run typecheck -w packages/db`

**Dependencies.** T1.

**Files likely touched.** `packages/db/src/paths.ts` (new),
`packages/db/src/index.ts` (add the `export * from './paths';` re-export),
`packages/db/test/backup.test.ts` (new — the `resolvePaths`/`selectPaths` describe block).

**Size.** Small. Placement note: the spec and the change's definition of done fix exactly
three `packages/db` suites (`snapshot`, `backup`, `restore`), so path-resolution cases
open the `backup` suite — `resolvePaths`/`selectPaths` are the backup command's inputs
(and `backup.test.ts`'s spec coverage includes `--only` selection). T6 completes this file
with the `db:backup` cases.

---

### T3 — `packages/db/src/snapshot.ts` (the one snapshot implementation)

**Description.** Implement the shared snapshot primitive exactly as the spec's interface
block (lines 189–224): `uniqueSnapshotPath`, `snapshotAndVerify`, `verifyDatabase`, and the
`SnapshotOptions`/`SnapshotResult` types. The copy is issued as
`source.prepare('VACUUM INTO ?').run(targetPath)`; the source handle is `readonly: true`
(the D3/D4 no-fork primitive the rest of the change depends on). Re-export the module from
`src/index.ts`.

**Acceptance criteria.**
- Exported surface matches the spec exactly:
  `interface SnapshotOptions { rowCountTables?: readonly string[] }`;
  `interface SnapshotResult { backupPath: string; quickCheck: 'ok'; rowCounts:
  Record<string, number> }`;
  `function uniqueSnapshotPath(sourceDbPath: string, suffix: string): string`;
  `function snapshotAndVerify(sourceDbPath: string, targetPath: string, options?:
  SnapshotOptions): SnapshotResult`;
  `function verifyDatabase(dbPath: string): 'ok'`.
- `uniqueSnapshotPath` is UTC, millisecond resolution, filename-safe
  (`new Date().toISOString().replace(/[:.]/g, '-')`), and composes the path as
  `sourceDbPath + '.' + suffix + '-' + stamp` — so
  `uniqueSnapshotPath('life.db', 'app')` returns `life.db.app-2026-10-01T12-34-56-789Z` —
  and falls back to a numeric suffix rather than ever returning an existing path.
- `snapshotAndVerify` creates `dirname(targetPath)` when missing; throws when the source
  is missing, when the source fails `quick_check`, when `VACUUM INTO` refuses an existing
  target, when the target does not appear, when the target fails `quick_check`, and when
  any `rowCountTables` count differs between source and copy; on success returns
  `{ backupPath: targetPath, quickCheck: 'ok', rowCounts }`.
- The source bytes and mtime are unchanged by a snapshot (read-only proof), and both
  source and copy pass `PRAGMA quick_check`.
- `verifyDatabase` opens read-only, returns `'ok'` when `quick_check` is `ok`, and throws
  otherwise.
- `src/index.ts` adds `export * from './snapshot';`.

**Verification (exact).**
- `npm run test:unit -w packages/db -- test/snapshot.test.ts`
- `npm run typecheck -w packages/db`

**Dependencies.** T1.

**Files likely touched.** `packages/db/src/snapshot.ts` (new),
`packages/db/test/snapshot.test.ts` (new), `packages/db/src/index.ts` (add the re-export).

**Size.** Small.

---

### T4 — tags-service consumes `@life/db`

**Description.** Delete the local `uniqueBackupPath` and `snapshotAndVerify` from
`apps/tags-service/src/tags/import.ts` and import the shared pair from `@life/db`;
re-point `cleanup.ts` at `@life/db`; declare the workspace dependency and the jest
`moduleNameMapper` entry. `import.ts` keeps the `pre-import` suffix; `cleanup.ts` adopts
the spec's `pre-cleanup` suffix, so the one `.pre-import-` assertion in
`cleanup-tags.test.ts` is updated to match its own command.

**Acceptance criteria.**
- `import.ts` no longer defines `uniqueBackupPath`/`snapshotAndVerify`; it imports
  `{ snapshotAndVerify, uniqueSnapshotPath }` from `@life/db` and calls
  `snapshotAndVerify(noteDbPath, uniqueSnapshotPath(noteDbPath, 'pre-import'))` and
  `snapshotAndVerify(tagsDbPath, uniqueSnapshotPath(tagsDbPath, 'pre-import'))`, mapping
  each result's `.backupPath` onto `ImportReport.noteBackupPath`/`tagsBackupPath`.
- `cleanup.ts` imports `{ snapshotAndVerify, uniqueSnapshotPath }` from `@life/db` and
  calls `snapshotAndVerify(paths.tagsDbPath, uniqueSnapshotPath(paths.tagsDbPath,
  'pre-cleanup'))`, mapping `.backupPath` onto `CleanupReport.backupPath`.
- `apps/tags-service/package.json` adds `"@life/db": "*"` to `dependencies` (after
  `@life/cache`) and `"^@life/db$": "<rootDir>/../../packages/db/src/index.ts"` to the jest
  `moduleNameMapper`.
- `cleanup-tags.test.ts` asserts the `.pre-cleanup-` suffix and its `backupFiles` helper
  filters `.pre-cleanup-`; no other assertion changes.
- After this task the D3 check matches two files: `packages/db/src/snapshot.ts` and
  `apps/note-service/scripts/backfill-owner.ts` (line 130).

**Setup (prerequisite, not a profile verification command).**
- `npm install` (from the repo root; records the new `@life/db` dependency).
- `npm run build -w packages/db` (produces `dist/` so `tsc` can resolve `@life/db`'s
  types during the consumer typecheck).

**Verification (exact profile commands).**
- `npm run typecheck -w @life/tags-service`
- `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts`
- `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts`
- `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'`

**Dependencies.** T3 (needs the shared snapshot surface and its built `dist`).

**Files likely touched.** `apps/tags-service/src/tags/import.ts`,
`apps/tags-service/src/tags/cleanup.ts`, `apps/tags-service/package.json`,
`apps/tags-service/test/cleanup-tags.test.ts`, `package-lock.json` (via `npm install`).

**Size.** Medium (5 files incl. the lockfile).

---

### T5 — note-service `backfill-owner.ts` consumes `@life/db`

**Description.** Delete the local `uniqueBackupPath` and `snapshotAndVerify` from
`apps/note-service/scripts/backfill-owner.ts` and import the shared pair; call the shared
helper with `rowCountTables: ['note']` to preserve the existing `note` row-count match,
and map the result onto the unchanged `BackupResult` shape. Declare the dependency and the
jest `moduleNameMapper` entry.

**Acceptance criteria.**
- The script no longer defines `uniqueBackupPath`/`snapshotAndVerify`; `runBackfill` calls
  `snapshotAndVerify(noteDbPath, uniqueSnapshotPath(noteDbPath, 'bak'), { rowCountTables:
  ['note'] })` and returns `backup: { backupPath: result.backupPath, verified: true,
  noteCount: result.rowCounts.note, quickCheck: 'ok' }`.
- The exported signatures `resolvePaths`, `runBackfill`, `main`, `BackupResult`,
  `ResolvedPaths`, `RunResult` are unchanged (the pre-existing suite depends on them).
- `apps/note-service/package.json` adds `"@life/db": "*"` to `dependencies` (after
  `@life/cache`) and `"^@life/db$": "<rootDir>/../../packages/db/src/index.ts"` to the jest
  `moduleNameMapper`.
- After this task the D3 check matches only `packages/db/src/snapshot.ts`.
- `owner-backfill.e2e-spec.ts` is unchanged and green, including the `.bak-` name
  assertions and the `noteCount` rollback proof.

**Setup (prerequisite, not a profile verification command).**
- `npm install` (from the repo root).
- `npm run build -w packages/db`

**Verification (exact profile commands).**
- `npm run typecheck -w @life/note-service`
- `npm run test:unit -w @life/note-service -- test/owner-backfill.e2e-spec.ts`
- `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'` → only
  `packages/db/src/snapshot.ts`.

**Dependencies.** T3.

**Files likely touched.** `apps/note-service/scripts/backfill-owner.ts`,
`apps/note-service/package.json`, `package-lock.json` (via `npm install`).

**Size.** Small (3 files incl. the lockfile). T4 and T5 each stay within the file budget,
so no further split is required.

---

### T6 — `db:backup` core, CLI, and suite

**Description.** Implement `packages/db/src/backup.ts` (routine/pinned modes, `--only`,
fail-closed missing input before any write, `manifest.json`, `PINNED` marker, retention,
deterministic exit codes, no stdin) with a thin `scripts/backup.ts` entry, and complete
`test/backup.test.ts` with the backup cases. Add the `db:backup` workspace script entry.

**Acceptance criteria.**
- Exported surface: `type BackupMode = 'routine' | 'deliberate'`;
  `interface ManifestEntry { name: DatabaseName; file: string; source: string; bytes:
  number; quickCheck: 'ok' }`; `interface BackupManifest { mode: BackupMode; createdAt:
  string; pinned: boolean; databases: ManifestEntry[] }`; `interface BackupResult {
  destination: string; mode: BackupMode; snapshots: ManifestEntry[] }`;
  `function runBackup(options: { argv: string[]; env?: NodeJS.ProcessEnv; now?: () =>
  Date }): BackupResult`; `function pruneRoutineSnapshots(backupRoot: string, keep?:
  number): { pruned: string[]; failed: string[] }`;
  `function main(argv?: string[], env?: NodeJS.ProcessEnv): number` (never calls
  `process.exit`).
- `DatabaseName` is imported from the package's own `./paths` module
  (`import type { DatabaseName } from './paths';`), declared and exported by T2, so the
  `ManifestEntry.name` reference resolves; the type is not redefined here.
- The run stamp is `new Date().toISOString().replace(/[:.]/g, '-')` computed once; the
  destination is `backup/2026-10-01T12-34-56-789Z/`, or
  `backup/2026-10-01T12-34-56-789Z-pinned/` with `--pin`, resolved against
  `INIT_CWD ?? cwd`; an existing destination is never overwritten.
- Selection defaults to all four databases; `--only life,idp` selects a subset; an unknown
  `--only` name is rejected before anything is written (exit 1).
- Fail closed (D10): if any selected database is missing, each missing path is printed and
  the command exits 1 **before** creating the destination directory or any file.
- Each selected database is written with `snapshotAndVerify(source, join(destination,
  basename(source)))`; sources are opened read-only (their bytes are unchanged).
- `manifest.json` records `mode`, UTC `createdAt`, `pinned`, and one entry per database
  (`name`, `file`, `source`, `bytes`, `quickCheck`); `--pin` also writes an empty `PINNED`
  marker and sets `mode: 'deliberate'`.
- Retention after a successful routine backup keeps the newest 10 routine snapshots
  (ordered by directory name) and prunes older routine ones; it never prunes a `-pinned`
  directory, a directory containing `PINNED`, a manifest with `mode: 'deliberate'` or
  `mode: 'pre-restore'`, or a directory without a readable `manifest.json`; a delete
  failure is a warning that does not change the exit code.
- The command reads no stdin and never prompts; repeated identical runs return the same exit
  code; one summary line per snapshot is printed and success exits 0.
- `scripts/backup.ts` imports `main` from `../src/backup`, re-exports it, and runs
  `if (require.main === module) { process.exitCode = main(); }` (the `cleanup-tags.ts`
  pattern).
- `apps/tags-service`-style guarantee applies here: `test/backup.test.ts` imports `main`
  from `../scripts/backup` so the thin entry is compiled by ts-jest.

**Verification (exact).**
- `npm run test:unit -w packages/db -- test/backup.test.ts`
- `npm run typecheck -w packages/db`

**Dependencies.** T2 (paths + `--only`), T3 (snapshot primitive).

**Files likely touched.** `packages/db/src/backup.ts` (new),
`packages/db/scripts/backup.ts` (new), `packages/db/test/backup.test.ts` (append the
`db:backup` cases), `packages/db/package.json` (add the `db:backup` script entry).

**Size.** Medium.

---

### T7 — `db:restore` core, CLI, and suite

**Description.** Implement `packages/db/src/restore.ts`: `--from`/`--only`, verification of
the chosen snapshot before use, the injected stack-stopped probe (fail closed on up OR
unknown with exit 2), a mandatory verified pre-restore snapshot before any overwrite,
WAL/SHM sibling removal, and a post-copy `quick_check`; a thin `scripts/restore.ts`; and
`test/restore.test.ts`. Add the `db:restore` workspace script entry.

**Acceptance criteria.**
- Exported surface: `type StackState = 'up' | 'down' | 'unknown'`;
  `type StackProbe = (port: number) => StackState | Promise<StackState>`;
  `interface RestoreResult { preRestoreDir: string | null; replaced: Array<{ name:
  DatabaseName; source: string; snapshot: string; preRestore: string | null }> }`;
  `function runRestore(options: { from: string; only?: readonly DatabaseName[]; env?:
  NodeJS.ProcessEnv; probe?: StackProbe; now?: () => Date }): Promise<RestoreResult>`;
  `function main(argv?: string[], env?: NodeJS.ProcessEnv, probe?: StackProbe):
  Promise<number>` (never calls `process.exit`).
- `DatabaseName` is imported from the package's own `./paths` module
  (`import type { DatabaseName } from './paths';`), declared and exported by T2, so the
  `RestoreResult`/`runRestore` references resolve; the type is not redefined here.
- `--from` is required and resolved against `INIT_CWD ?? cwd`; a missing `--from`, an
  unknown `--only` name, or a `--from` directory that does not exist exits 1 before any
  write. With no `--only`, every database file present in the snapshot directory is
  restored.
- Preconditions (before any write): every selected snapshot file exists; every selected
  snapshot passes `verifyDatabase`; the probe reports all ports `down` — any `up` or
  `unknown` prints the reason and exits 2, replacing nothing.
- Per selected database, in order: if the live target exists, a verified pre-restore
  snapshot is taken first at
  `backup/pre-restore-2026-10-01T12-34-56-789Z/life.db` (a failure aborts the whole
  restore before that target is touched; a target that does not exist records
  `preRestore: null`); the stale `-wal` and `-shm` sibling files of the target are
  removed; the verified snapshot is copied over the target; the target is reopened
  read-only and must pass `PRAGMA quick_check` (a failure exits 1, with the pre-restore
  snapshot as the recovery path).
- `manifest.json` is written into the pre-restore directory with `mode: 'pre-restore'`,
  `pinned: true`, one entry per replaced file, plus an empty `PINNED` marker.
- Restore never deletes or prunes a snapshot; it prints one line per restored database,
  reads no stdin, and exits 0.
- Every test injects the probe (a function argument) and touches only temp fixtures; the
  suite includes the undo proof: after a restore, restoring the pre-restore snapshot
  returns the database to its prior state.

**Verification (exact).**
- `npm run test:unit -w packages/db -- test/restore.test.ts`
- `npm run typecheck -w packages/db`

**Dependencies.** T2 (paths), T3 (snapshot + `verifyDatabase`).

**Files likely touched.** `packages/db/src/restore.ts` (new),
`packages/db/scripts/restore.ts` (new), `packages/db/test/restore.test.ts` (new),
`packages/db/package.json` (add the `db:restore` script entry).

**Size.** Medium.

---

### T8 — Root scripts and runbook Step 2

**Description.** Wire the two root-level convenience scripts and replace the runbook's
manual snapshot block in Step 2 with the new pinned backup command, per the spec
(lines 91–93 and 105–106).

**Acceptance criteria.**
- Root `package.json` `scripts` adds `"db:backup": "npm run db:backup -w @life/db --"`
  and `"db:restore": "npm run db:restore -w @life/db --"`; no other script changes.
- `docs/runbooks/production-deploy.md` Step 2 keeps `docker compose down` and the
  "Backups are readable" checklist, and replaces the manual snapshot block (the
  `mkdir -p backup/$(date +%Y%m%d-%H%M%S)` line, the two `cp` lines, and the stale
  "tags.db / todo.db will not exist yet" comment) with the single command
  `npm run db:backup -w @life/db -- --pin`. The stale comment is removed because the new
  command fails closed on a missing selected database by design (D10), and the spec's
  `--only life,idp` form (Commands section) is the documented way to back up a subset.
- No manual `cp` snapshot line remains in the runbook.

**Verification (exact).** Documentation/config only (global §3: no test for a docs
change; the runbook edit and root scripts must not be exercised against real data).
- `grep -n "\"db:backup\"\|\"db:restore\"" package.json`
- `grep -n "cp apps/\|mkdir -p backup/" docs/runbooks/production-deploy.md`
  → zero hits.
- `grep -n "npm run db:backup -w @life/db -- --pin" docs/runbooks/production-deploy.md`
  → one hit.
- Read the edited Step 2 back to confirm the `docker compose down` and readability lines
  are intact.

**Dependencies.** T6, T7 (their commands must exist before the root scripts point at
them).

**Files likely touched.** `package.json` (root — `scripts`), `docs/runbooks/production-deploy.md`.

**Size.** Small.

---

### T9 — Final verification (no code change)

**Description.** Close the change by running the D3 no-fork check, the Contract 2
mechanical check, the typecheck, and the mandated targeted suites once each, then
confirming no frozen surface and no `apps/*/data/**` file was touched.

**Acceptance criteria (the change's definition of done).**
- The D3 check is green: `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'` matches
  only `packages/db/src/snapshot.ts` (see §6).
- `grep -rni "redis" packages/db/src` → zero hits (Contract 2 "Cache Rules" mechanical
  check).
- `npm run typecheck -w packages/db` exits 0.
- The three `packages/db` suites are green: `test/snapshot.test.ts`, `test/backup.test.ts`,
  `test/restore.test.ts`.
- `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` green.
- `npm run test:unit -w @life/note-service -- test/owner-backfill.e2e-spec.ts` green.
- `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts` green (spec
  Success Criterion 7 convergence).
- No frozen surface changed: no diff under the e2e selector surface, token values
  (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`), or PWA constants
  (`apps/app/public/manifest*.json`, `viewport.themeColor`).
- No `apps/*/data/**` file changed; none was opened.

**Verification (exact; one execution per named suite, at most one re-execution of a suite
that fails after its fix — max 2 runs per suite).**
- `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'`
- `grep -rni "redis" packages/db/src`
- `npm run typecheck -w packages/db`
- `npm run test:unit -w packages/db -- test/snapshot.test.ts`
- `npm run test:unit -w packages/db -- test/backup.test.ts`
- `npm run test:unit -w packages/db -- test/restore.test.ts`
- `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts`
- `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts`
- `npm run test:unit -w @life/note-service -- test/owner-backfill.e2e-spec.ts`
- `git status --porcelain` and `git diff --stat` (confirm no `packages/ui/**`,
  `apps/app/**`, token/PWA files, or `apps/*/data/**` are present in the diff)

No full-suite runner, no unfiltered `npm run test:unit`, and no Playwright command is
used. This task changes no file except (if a failure requires correction) the owning
task's files, recorded as a deviation.

**Dependencies.** T4, T5, T6, T7, T8.

**Files likely touched.** None (read-only verification). A failing suite is corrected
within the owning task's allowed files and this task is re-run from its failing point.

**Size.** Small.

## 6. The D3 no-fork mechanical check (task-level verification)

Command: `grep -rn "VACUUM INTO ?" packages apps --include='*.ts'`

- **Before T4+T5 (as the tree stands now):** two matches, both in the local
  implementations this change removes:
  - `apps/tags-service/src/tags/import.ts:271`
  - `apps/note-service/scripts/backfill-owner.ts:130`
- **After T4 (tags-service refactored, note-service not yet):** two matches —
  `packages/db/src/snapshot.ts` and `apps/note-service/scripts/backfill-owner.ts:130`.
- **After T5:** exactly one match — `packages/db/src/snapshot.ts`, the single copy of
  `source.prepare('VACUUM INTO ?').run(targetPath)`. This is Checkpoint 3 and is asserted
  again in T9.

The check is statement-scoped (the `?` matches the prepared-statement text), so the prose
comments that document the mechanism in `import.ts`, `cleanup.ts`, `cleanup-tags.ts`, and
`backfill-owner.ts` are not matched and are kept.

## 7. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | `ts-node` running `scripts/backup.ts` / `scripts/restore.ts` under a `tsconfig.json` with `rootDir: src` and `include: ["src/**/*"]` (mirroring `packages/shared`) may raise a "file is not under rootDir" compile error for the script entry. | The script logic lives in `src/` and is fully typechecked/tested; the thin entry is compiled by ts-jest because the suites import `main` from `../scripts/backup`/`../scripts/restore`. If the exact spec command `ts-node scripts/backup.ts` errors at runtime, run the entry with `ts-node -T scripts/backup.ts` (transpile-only; the logic is already typechecked by `src`), record it as a deviation, and keep the workspace script semantics. |
| 2 | `cleanup.ts` switching to the spec's `pre-cleanup` suffix breaks the pre-existing `cleanup-tags.test.ts` assertion of `.pre-import-`. | T4 updates the one suffix assertion (line 349) and the `backupFiles` filter (line 176) to `.pre-cleanup-`; `import.ts` keeps `pre-import`, so `import-tags.test.ts` is untouched and stays green. |
| 3 | `tsc` resolves `@life/db` through `packages/db/dist`, so consumer typechecks fail if `dist` is missing or stale. | T4/T5 run `npm run build -w packages/db` before the consumer typecheck. Jest resolves `@life/db` through `moduleNameMapper` to `src`, independent of `dist`. |
| 4 | New workspace/dependency entries leave `package-lock.json` stale and `node_modules/@life/db` unlinked. | T1, T4, and T5 each run `npm install` from the repo root after editing manifests; the lockfile change is part of the change. |
| 5 | The real stack-stopped probe is async (TCP), but tests must be deterministic and touch no port. | `StackProbe` is an injected function typed to allow a synchronous return; every restore test injects a stub. Production uses the two-port `127.0.0.1:3002`/`3003` probe with a one-second timeout (spec "Restore safety check"). |
| 6 | Retention accidentally prunes a pinned / deliberate / pre-restore / manifest-less directory. | The fail-safe rules are explicit in T6 and covered by a retention case that seeds routine, pinned, and manifest-less directories and asserts only the excess routine ones are removed. |
| 7 | A test or agent touches `apps/*/data/**` (the hard line). | Every fixture is `mkdtempSync` under the OS temp dir; T9's `git status`/`git diff --stat` confirms no data file changed. |
| 8 | The runbook's pinned command fails closed on a stack missing a database (tags.db/todo.db on a master-based stack). | This is the spec's D10 behavior; the spec's `--only life,idp` form (Commands section) is the documented subset escape hatch. T8 is the only runbook edit and uses the spec's exact command. |
| 9 | The root `db:backup`/`db:restore` scripts are wired to non-existent workspace commands if ordered early. | T8 depends on T6 and T7. |

## 8. Verification and definition of done (ties to the spec's Success Criteria)

Definition of done for the change:
- [ ] D3 no-fork grep green: only `packages/db/src/snapshot.ts` matches
  (`grep -rn "VACUUM INTO ?" packages apps --include='*.ts'`) — spec criterion 7, D3.
- [ ] `npm run typecheck -w packages/db` exits 0 and the three `packages/db` suites
  (`test/snapshot.test.ts`, `test/backup.test.ts`, `test/restore.test.ts`) are green —
  spec criterion 9.
- [ ] `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` green and
  `npm run test:unit -w @life/note-service -- test/owner-backfill.e2e-spec.ts` green —
  spec criterion 7 convergence.
- [ ] No frozen surface changed (e2e selectors, token values, PWA constants) and no
  `apps/*/data/**` file was touched.
- [ ] The spec's Success Criteria 1–9 are satisfiable by the delivered commands:
  1 routine backup writes `backup/2026-10-01T12-34-56-789Z/` with per-database
  quick_check-clean files plus `manifest.json` and exits 0; 2 `--pin` writes
  `backup/2026-10-01T12-34-56-789Z-pinned/` with a `PINNED`
  marker and is distinguishable by name and manifest; 3 after an 11th routine run exactly
  the newest 10 routine snapshots remain and every pinned snapshot is untouched; 4 a
  missing selected database exits non-zero with nothing created; 5 restore exits 2 and
  replaces nothing while the probe reports a port up, and with both refused replaces the
  selected files only after a verified pinned pre-restore snapshot; 6 restoring the
  pre-restore snapshot returns the database to its prior state; 7 the no-fork grep plus
  the three convergence suites; 8 every command exits 0 on success and a documented
  non-zero code on failure with stdin closed and no prompt; 9 typecheck plus the three
  suites.
- [ ] Feature close: the `five-lane-verification` skill returns **N/N PASS** (no partial
  verdict counts as done). Merge to `master` still requires the user's explicit request.

## 9. Open questions

None. The spec resolved the boundary questions that were left open in the intent
(helper home, command/script names, how pinning is expressed, whether restore verifies the
chosen snapshot, and whether the runbook's `cp` line is replaced). Three plan-level
judgment calls are recorded rather than left open: (a) path-resolution cases open
`packages/db/test/backup.test.ts` because the spec fixes exactly three suites; (b) the
cleanup suffix assertion in `cleanup-tags.test.ts` is updated to the spec's `pre-cleanup`
suffix; (c) the `db:backup`/`db:restore` workspace script entries are added by T6/T7 with
their files, so the final manifest equals the spec's block with no dangling entry.

## Deviations from the suggested decomposition

- **T2's unit cases live in `packages/db/test/backup.test.ts`, not a new `paths.test.ts`.**
  Reason: the spec's Project Structure and the change's definition of done fix exactly
  three `packages/db` suites; a fourth would contradict both. `resolvePaths`/`selectPaths`
  are the backup command's inputs, and the backup suite's spec coverage includes `--only`
  selection. T6 completes the same file.
- **The `db:backup`/`db:restore` script entries are deferred to T6/T7** instead of landing
  in T1's manifest. Reason: a workspace script entry must point at an existing file; the
  final manifest still equals the spec's block.
- **T4 includes one assertion update in `apps/tags-service/test/cleanup-tags.test.ts`.**
  Reason: the spec's locked cleanup call uses the `pre-cleanup` suffix, so the pre-existing
  `.pre-import-` assertion must follow; the suite is green at the checkpoint.
