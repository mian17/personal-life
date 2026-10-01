# Implementation Plan: orphan-tag-cleanup — operator-run orphan registry cleanup

Branch: `refactor/notes-todos-shared-ui` (`master` stays untouched until the user asks to
merge). Home service: `apps/tags-service` (it owns the `tag` table).

Process: global protocol §3 (testing), §5 (mandatory task template), §6 (plan validation
gate), §7 (review + five-lane gate). Every task below is in §5 template form. Test runs
are targeted, named files only, max 2 executions; no full suite; NO E2E (no browser
surface is touched). Every task is reviewed under §7 (blast radius, contract, project
contracts) before the next dependent task starts. The five-lane gate is executed by five
parallel subagent lanes, not a shell command.

## Objective

Add an operator-run maintenance script, `cleanup-tags`, that deletes **orphaned tag
rows**: registry rows (`tag` in `tags.db`) referenced by **neither** note-service's
`note_tag` (in `life.db`) **nor** todo-service's `todo_tag` (in `todo.db`).

Success = the script plans (read-only) and applies (verified backup → transactional hard
delete) the set difference between the registry's integer ids and the union of the two
association tables' `tagId` sets — with ids-only output, fail-closed on any missing input
DB, a documented cache-staleness stance, and the sole-writer deviation recorded in
`SPEC-tags-service.md`.

## User request (Change 1 of a two-part request)

> Add an operator-run maintenance script that deletes orphaned tag rows — tags referenced
> by no note and no todo.

**Out of scope (explicit).** The **root-cause fix** — stopping the notes autosave from
creating partial-token tags in the first place — is a **separate, later change**. This
plan does not build, plan, test, or touch it; `cleanup-tags` is a remediation tool for
rows the autosave bug already produced, not a fix for the bug.

## Scope

- **In:** the tested core `apps/tags-service/src/tags/cleanup.ts`; the thin CLI
  `apps/tags-service/scripts/cleanup-tags.ts`; the `package.json` `cleanup-tags` script
  entry; the `## Maintenance scripts` section in `docs/specs/SPEC-tags-service.md`; the
  suite `apps/tags-service/test/cleanup-tags.test.ts`.
- **Out:** the notes autosave / partial-token fix; any change to `apps/note-service/**`,
  `apps/todo-service/**`, `apps/app/**`, `packages/**`; any change to the tags-service
  request path (`tags.service.ts`, `tags.controller.ts`, `tags-cache.ts`,
  `tags.module.ts`); a Redis connection from the script; any schema/DDL change; any
  `apps/*/data/**` access in code or tests.
- **Not engaged — Contract 1 (shared UI).** No frontend or `@life/ui` surface is touched;
  no primitive-reuse plan applies.
- **Engaged — Contract 2 (backend data layer) only as a *writer* deviation.** The script
  writes the `tag` table directly and never reads through the read-through cache; the
  spec's `## Cache Rules` section already exists and is not amended except as referenced
  by the new maintenance section (T1). See **Design → Cache decision** and T2's *Cache
  plan*.

## Ground truth (from prior reconnaissance — given, not re-derived)

**Data model**

- Registry: `apps/tags-service/src/tags/tag.entity.ts:21-39` — table **`tag`** (singular),
  columns `id` (integer autoincrement PK, **not** uuid), `name` (`enc.v1` ciphertext),
  `ownerSub` (text), `version` (int), `createdAt`. Hard delete
  (`apps/tags-service/src/tags/tags.service.ts:228-232`). No usage/count column.
- Notes: `apps/note-service/src/notes/note-tag.entity.ts:19-25` — table
  **`note_tag(noteId, tagId)`**, composite PK, `tagId` plaintext int, no FK. Lives in
  **note-service's `life.db`**. Note soft-delete = `note.deletedAt`
  (`apps/note-service/src/notes/note.entity.ts:30-31`); trashing keeps `note_tag` rows;
  permanent delete cascades.
- Todos: `apps/todo-service/src/todos/todo-tag.entity.ts:13-19` — table
  **`todo_tag(todoId, tagId)`**, same shape, lives in **todo-service's DB (`todo.db`)**;
  `todo.deletedAt` soft-delete keeps join rows.
- The legacy `tag` table in `life.db` was dropped by the import migration
  (`apps/tags-service/src/tags/import.ts:576-626`) — the script must **not** read it.

**Database files (paths only — never open `apps/*/data/**`)**

- `apps/tags-service/data/tags.db` — tables `tag`, `user_keys`
- `apps/note-service/data/life.db` — tables `note`, `note_tag`, `user_keys`
- `apps/todo-service/data/todo.db` — tables `todo`, `todo_tag`, `list`, `user_keys`

**House script conventions (copy these)**

- `apps/tags-service/scripts/import-tags.ts` (thin CLI;
  `if (require.main === module) process.exitCode = main();`) over a tested core
  `apps/tags-service/src/tags/import.ts`.
- `main(argv = process.argv.slice(2), deps)` returning `0`/`1`, NEVER calling
  `process.exit` (so tests call `main()` directly). Injected deps
  `{ env, print, printError }`.
- Arg style: literal `argv.includes('--dry-run')` — no arg-parsing library.
- DB paths resolved via
  `resolveDbPath('TAGS_DB_PATH'|'NOTE_DB_PATH'|'TODO_DB_PATH', <default>, env)` from
  `@life/shared` (`packages/shared/src/db-path.ts:24-35`); defaults anchored at repo root
  via `__dirname` hops (`apps/tags-service/src/tags/import.ts:56-77`).
- Reads via `better-sqlite3`; apply = `VACUUM INTO` backup + `PRAGMA quick_check` BEFORE
  any write (`import.ts:256-292`); `plan*` vs `apply*` split; deterministic report line
  (`formatImportReport`, `import.ts:696-702`).
- npm script wiring in `apps/tags-service/package.json`
  (`"import-tags": "ts-node scripts/import-tags.ts"`).
- `snapshotAndVerify(dbPath)` is **exported** by `import.ts` (`import.ts:256`) and is
  reused verbatim — the backup helper is not forked.
- **Toolchain note (verified):** `apps/tags-service/tsconfig.json` has
  `"include": ["src/**/*"]`, so `npm run typecheck` compiles `src/tags/cleanup.ts` but
  **not** `scripts/**`. The CLI is compiled by ts-jest because the suite imports `main`
  from `../scripts/cleanup-tags` (the exact `import-tags` precedent,
  `apps/tags-service/test/import-tags.test.ts:20`). This is why the CLI and the suite live
  in the same task.

**Test infra (copy `apps/tags-service/test/import-tags.test.ts`)**

- `mkdtempSync` fixtures, `new Database(path)`, schema via `db.exec(SCHEMA)`, fixture
  builders per DB.
- Call `main(argv, { env, print, printError })` and assert the RETURN CODE and the printed
  line.
- Dry-run byte-purity asserted via `sha256` of the DB before/after.
- The suite must NEVER open anything under `apps/*/data/`.
- Commands: `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts`;
  typecheck `npm run typecheck` in `apps/tags-service`.

## Design

### Orphan definition (exact) and the trashed-rows decision

```
referenced = { tag.id : tag.id ∈ DISTINCT(note_tag.tagId) ∪ DISTINCT(todo_tag.tagId) }
orphans    = { tag.id : tag.id ∉ referenced }
```

- `scanned` = number of `tag` rows in `tags.db`; `referenced` = the scanned rows that are
  referenced; `orphans = scanned − referenced` (the arithmetic is part of the contract and
  is asserted in tests).
- **Trashed rows COUNT as references** — the script never filters on
  `note.deletedAt` / `todo.deletedAt`. A tag held only by a trashed note or todo is
  **kept**, because restore must keep working. This is an explicit decision: the script's
  SQL must not mention `deletedAt` at all (verification greps for it).
- **Set difference on plaintext integer ids only.** No decryption, no name read, no
  `TAGS_MASTER_KEY` requirement. The output prints **ids + `ownerSub`**, never names.

### Fail-closed inputs

- If **any** of `tags.db`, `life.db`, `todo.db` **does not exist as a file**, the script
  errors and deletes nothing (an absent DB means orphanhood cannot be proven). The
  existence check runs before the backup and before any write.
- An **existing** DB whose join table genuinely does not exist contributes the empty
  set (`tableExists` guard per DB); a missing `note_tag`/`todo_tag` table adds no
  references. A `tags.db` with no `tag` table scans zero rows and deletes nothing.

### Backup-before-write

- Apply is the **default**; `--dry-run` plans. Apply always takes the verified
  `VACUUM INTO` snapshot via the shared `snapshotAndVerify` (source read-only →
  `PRAGMA quick_check` = `ok` → `VACUUM INTO` → copy re-checked) **before** the delete
  transaction. The snapshot captures the pre-delete registry state.
- Plan opens the three DBs read-only only; no snapshot, no write (byte-purity asserted).

### Transaction and owner scoping

- Deletes run in one `db.transaction(...)` on `tags.db`; each orphan is removed with
  `DELETE FROM "tag" WHERE "ownerSub" = ? AND "id" = ?` (per-owner scoped, hard delete).
  A failed delete rolls the whole transaction back; the CLI surfaces the failure and
  returns `1`.

### Cache decision (Contract 2 / decision 7) — stack stopped

Chosen: **(a) require the stack to be stopped** (the `import-tags` precedent), the lazy
option. The script never reads through, writes to, or connects to Redis/cache.

Justification (why (a) and not (b) bumping `tags:gen:<sub>`):

- The script's SQL hard-deletes rows directly, bypassing the per-owner generation counter
  the request path bumps (`docs/specs/SPEC-tags-service.md:61-68`). A cached
  `tags:<sub>:v<gen>:all` entry could therefore serve a deleted tag.
- Option (b) would add a Redis client, a `REDIS_URL` dependency, a second invalidation
  path, and new failure modes (Redis down → fail-open → stale entry stays anyway) to an
  operator-run script whose whole point is to run while nothing is serving.
- Running with the stack stopped means nothing can serve a stale entry during the run,
  and the cache's documented **60 s TTL backstop** bounds any residual staleness after a
  restart — the same ceiling the spec already declares for reads
  (`docs/specs/SPEC-tags-service.md:66`). The import-tags deploy checklist already
  establishes "stop the stack" for a raw-SQL writer, so this adds no new operational
  concept.
- The script is a deliberate **second writer** to `tag` (the spec's data model calls the
  service sole writer, M2). Recorded as the sanctioned operator-run deviation in the T1
  spec section, exactly like `import-tags`.

### Report (deterministic, ids-only)

**Two shapes, printed in this order by `main`:**

**(a) One summary line** — exactly what `formatCleanupReport` returns, mirroring
`formatImportReport`:

```
cleanup-tags [plan|apply]: scanned=N referenced=R orphans=M deleted=D errors=0
```

- `errors` is always `0` on a returned report; any failure throws and `main` prints
  `cleanup-tags failed: <message>` and returns `1` (never `process.exit`).
- `deleted` is `0` in plan mode and the number of rows removed in apply mode.

**(b) One detail line per orphan row**, emitted by `main` immediately after the summary
line, ordered by `id` ascending so output is deterministic and diffable:

```
orphan id=<id> owner=<ownerSub>
```

- Format: `` `orphan id=${id} owner=${ownerSub}` `` — ids and `ownerSub` only, **never**
  the `name` (it is `enc.v1.` ciphertext and the script never decrypts).
- The rows come from the report's `orphanRows` array; `orphans` (the summary count) **must
  equal `orphanRows.length`**, and a test asserts that invariant.
- Plan mode prints the same detail lines (what *would* be deleted); apply mode prints what
  *was* deleted. Zero orphans → summary line only.
- Detail lines are skipped when `main` returns `1` (the error line is the only output).

This reconciles decision 3 (ids + `ownerSub` in the output, asserted by test 12) with
decision 9 (the fixed summary string, asserted by test 13): the summary stays a single
counts-only line, and the ids live on their own detail lines.

### File structure

Create:

- `apps/tags-service/src/tags/cleanup.ts` (T2) — core: `resolvePaths`, orphan computation,
  `planCleanup`, `applyCleanup`, `formatCleanupReport`, `formatOrphanLine`, `main`,
  `CleanupCliDeps`/`CleanupReport`/`CleanupPaths`/`CleanupOrphan`/`CleanupMode` types,
  path-default constants, and a local (non-exported) `tableExists`.
- `apps/tags-service/scripts/cleanup-tags.ts` (T2) — thin CLI re-exporting the core
  `main` (mirrors `scripts/import-tags.ts`).
- `apps/tags-service/test/cleanup-tags.test.ts` (T2) — suite (fixture builders + the
  required cases; imports `main` from the CLI script and the core from
  `../src/tags/cleanup`).

Modify:

- `apps/tags-service/package.json` (T2) — add
  `"cleanup-tags": "ts-node scripts/cleanup-tags.ts"` after the `import-tags` line.
- `docs/specs/SPEC-tags-service.md` (T1) — add the `## Maintenance scripts` section.

Not modified: `apps/tags-service/src/tags/import.ts` (reused read-only; its export
`snapshotAndVerify` is consumed, not changed); `tag.entity.ts`, `tags.service.ts`,
`tags.controller.ts`, `tags-cache.ts`, `tags.module.ts`; every other `apps/**` and
`packages/**`; `apps/*/data/**`; the Project Profile table; any token/e2e surface.

## Task List

### Phase 1 — Spec note (spec-first)
- [ ] T1: record `cleanup-tags` in `docs/specs/SPEC-tags-service.md`.

### Checkpoint: Spec
- [ ] The `## Maintenance scripts` section exists with the orphan definition, the
      trashed-rows rule, ids-only logging, fail-closed inputs, backup-before-write, the
      cache stance, the sole-writer deviation, and the report line.

### Phase 2 — Script (core + CLI + wiring + suite)
- [ ] T2: `cleanup.ts` core + `scripts/cleanup-tags.ts` + `package.json` entry +
      `test/cleanup-tags.test.ts` (TDD: write the suite, red → implement, green).

### Checkpoint: Script
- [ ] `npm run typecheck` in `apps/tags-service` exits 0.
- [ ] `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` green.
- [ ] `grep -nE "deletedAt|decrypt|unwrapDek|TAGS_MASTER_KEY|getThrough|redis"` over
      `src/tags/cleanup.ts` + `scripts/cleanup-tags.ts` returns zero hits.

### Phase 3 — Verification gate
- [ ] Contract 2 mechanical checks + the default-path regression suite (see *Verification
      gate*).
- [ ] Five-lane verification (`five-lane-verification`) returns N/N PASS.

### Checkpoint: Complete
- [ ] All acceptance criteria met; `master` untouched; merge awaits the user's explicit
      request.

## Tasks in §5 template form

### T1 — `SPEC-tags-service` maintenance-script section (module `tags-service-spec`)

[TASK OBJECTIVE]
  Record the `cleanup-tags` maintenance script in `docs/specs/SPEC-tags-service.md`
  before any code: orphan definition, trashed-rows rule, ids-only logging,
  fail-closed inputs, backup-before-write, cache staleness, and the sole-writer
  deviation.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `docs/specs/SPEC-tags-service.md` (append one
    `## Maintenance scripts` section; no existing section is rewritten).
  - Reference files (read-only): `docs/specs/SPEC-tags-service.md`,
    `apps/tags-service/src/tags/import.ts`, `apps/tags-service/scripts/import-tags.ts`,
    `apps/tags-service/src/tags/tag.entity.ts`, `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above — in particular any
    `apps/**`/`packages/**` source or test, any `apps/*/data/**`, and the Project
    Profile table.

[IMPLEMENTATION REQUIREMENTS]
  - Add a `## Maintenance scripts` section (after `## Cache Rules`, before
    `## Health`) containing a `### cleanup-tags — orphan registry cleanup` subsection
    that states, in this order:
    1. **Purpose/trigger:** operator-run remediation for orphaned registry rows.
    2. **Orphan definition (exact):** a `tag.id` appearing in neither
       `note_tag.tagId` (`life.db`) nor `todo_tag.tagId` (`todo.db`); set difference on
       plaintext integer ids.
    3. **Trashed rows count as references:** soft-deleted (`deletedAt`) notes/todos keep
       their join rows; a tag held only by a trashed row is **not** orphaned (restore
       must keep working). The script never reads `deletedAt`.
    4. **Ids-only logging / no decryption:** the report prints ids + `ownerSub`, never
       names; `TAGS_MASTER_KEY` is not required; the legacy `tag` table in `life.db` is
       not read.
    5. **Fail-closed inputs:** a missing `tags.db`/`life.db`/`todo.db` file → error,
       nothing deleted; an existing DB whose join table genuinely does not exist
       contributes the empty set.
    6. **Backup-before-write:** apply is the default; `--dry-run` is read-only and
       byte-pure; apply takes `VACUUM INTO` + `PRAGMA quick_check` (shared
       `snapshotAndVerify`) before the delete transaction; deletes are per-owner-scoped
       hard deletes inside one transaction.
    7. **Cache staleness / stack-stopped rule:** raw SQL bypasses the per-owner
       generation bump, so `tags:<sub>:v<gen>:all` can serve deleted tags up to the
       60 s TTL backstop; the mitigation is to run with the stack stopped (the
       `import-tags` precedent) and the script never reads through, writes to, or
       connects to Redis.
    8. **Sole-writer deviation (M2):** the data model declares the service sole writer of
       `tag`; this operator-run script is the one sanctioned second writer (like
       `import-tags`), hard-deleting only, never inserting/renaming; the request path
       stays the sole writer.
    9. **Command + env overrides:**
       `npm run cleanup-tags -w @life/tags-service -- [--dry-run]`, with
       `TAGS_DB_PATH`/`NOTE_DB_PATH`/`TODO_DB_PATH` overrides (defaults anchored at the
       repo root).
    10. **Report line:**
        `cleanup-tags [plan|apply]: scanned=N referenced=R orphans=M deleted=D errors=0`.
  - Keep the existing text untouched; no placeholder/TODO wording; the section must not
    restate or duplicate `## Cache Rules` beyond linking the staleness consequence.

[VERIFICATION & TESTING RULES]
  - No test command: this is a documentation-only task (global §3 — docs changes take no
    test; NO E2E).
  - Permitted checks (read-only, max-test-runs: 2):
    `grep -n "## Maintenance scripts" docs/specs/SPEC-tags-service.md` (present), and the
    Tech Lead reads the section back confirming all ten points above and that no
    pre-existing line changed.
  - Strict constraints: no code, no test, no `apps/*/data/**`, no Project Profile edit.

[DEFINITION OF DONE]
  - [ ] The `## Maintenance scripts` section exists with all ten contract points.
  - [ ] Orphan definition, trashed-rows rule, fail-closed rule, cache stance and
        sole-writer deviation are explicit and match this plan verbatim.
  - [ ] No file outside the allowed scope was modified.
  - [ ] No existing spec section was rewritten.

---

### T2 — `cleanup-tags` script (module `orphan-tag-cleanup`)

[TASK OBJECTIVE]
  Deliver the `cleanup-tags` maintenance script — a tested core, a thin CLI, the npm
  entry, and the suite — that deletes exactly the orphaned `tag` rows with a verified
  backup first and an ids-only report.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/tags-service/src/tags/cleanup.ts` (new),
    `apps/tags-service/scripts/cleanup-tags.ts` (new),
    `apps/tags-service/test/cleanup-tags.test.ts` (new),
    `apps/tags-service/package.json` (one script line only).
  - Reference files (read-only): `apps/tags-service/src/tags/import.ts` (reuse
    `snapshotAndVerify`; do **not** modify it), `apps/tags-service/scripts/import-tags.ts`,
    `apps/tags-service/test/import-tags.test.ts`, `apps/tags-service/test/setup-env.ts`,
    `apps/tags-service/src/tags/tag.entity.ts`,
    `apps/note-service/src/notes/note-tag.entity.ts`,
    `apps/todo-service/src/todos/todo-tag.entity.ts`,
    `packages/shared/src/db-path.ts`, `docs/specs/SPEC-tags-service.md`,
    `docs/lessons/` (recall).
  - Strictly prohibited files: every file not listed above — in particular
    `src/tags/import.ts`, `tags.service.ts`, `tags.controller.ts`, `tags-cache.ts`,
    `tags.module.ts`, all of `apps/note-service/**` and `apps/todo-service/**`, all
    `packages/**`, every `apps/*/data/**`, and the Project Profile table. The script must
    not touch Redis or any `apps/*/data/**` path.

[IMPLEMENTATION REQUIREMENTS]
  - **Core (`src/tags/cleanup.ts`).** Export exactly:
    `DEFAULT_NOTE_DB_PATH`, `DEFAULT_TODO_DB_PATH`, `DEFAULT_TAGS_DB_PATH` (repo-root
    anchored with four `'..'` hops from `apps/tags-service/src/tags`, mirroring
    `import.ts:56-77`); `type CleanupMode = 'plan' | 'apply'`;
    `interface CleanupPaths { noteDbPath: string; todoDbPath: string; tagsDbPath: string }`;
    `interface CleanupOrphan { id: number; ownerSub: string }` (the two plaintext columns,
    never `name`);
    `interface CleanupReport { mode: CleanupMode; scanned: number; referenced: number;
    orphans: number; deleted: number; errors: number; backupPath: string | null;
    orphanRows: readonly CleanupOrphan[] }` (invariant: `orphans === orphanRows.length`,
    asserted in the suite);
    `function resolvePaths(env?: NodeJS.ProcessEnv): CleanupPaths` (uses
    `resolveDbPath('NOTE_DB_PATH', …)`, `resolveDbPath('TODO_DB_PATH', …)`,
    `resolveDbPath('TAGS_DB_PATH', …)`); `function planCleanup(paths: CleanupPaths):
    CleanupReport`; `function applyCleanup(paths: CleanupPaths): CleanupReport`;
    `function formatCleanupReport(report: CleanupReport): string` (summary line, (a) above);
    `function formatOrphanLine(orphan: CleanupOrphan): string` (detail line, (b) above —
    exactly `` `orphan id=${orphan.id} owner=${orphan.ownerSub}` ``);
    `interface CleanupCliDeps { env?: NodeJS.ProcessEnv; print?: (line: string) => void;
    printError?: (line: string) => void }`;
    `function main(argv?: string[], deps?: CleanupCliDeps): number` — prints
    `formatCleanupReport(report)`, then `formatOrphanLine(row)` for each `report.orphanRows`
    in ascending `id` order.
  - **Fail-closed first.** `planCleanup` and `applyCleanup` both begin by asserting all
    three files exist (`existsSync`), throwing `database does not exist: <path>` naming
    the missing file. No backup, no read of other DBs, no write happens before this.
  - **Reads (plaintext columns only).** `note_tag` in `life.db` and `todo_tag` in
    `todo.db`: `SELECT DISTINCT "tagId" FROM "<table>"`, guarded by `tableExists` (a
    genuinely absent table contributes the empty set). Registry rows from `tags.db`:
    `SELECT "id","ownerSub" FROM "tag" ORDER BY "id"`, guarded by `tableExists` (absent →
    zero scanned rows). **`tableExists` is defined locally inside `cleanup.ts` and is NOT
    exported** — `import.ts:203`'s copy is private and `import.ts` is consumed read-only
    for `snapshotAndVerify` only, so it cannot be imported from there. Never select `name`;
    never decrypt; never read the legacy `tag` table in `life.db`; never read `deletedAt`.
  - **Orphan computation.** `referenced = scanned tag rows whose id ∈ (noteIds ∪
    todoIds)`; `orphans = scanned − referenced`; the orphan rows carry `{ id, ownerSub }`
    for the delete **and** the report (`CleanupOrphan[]`, sorted by `id`).
  - **Plan mode.** Open all three DBs `{ readonly: true }`; compute; return
    `{ mode: 'plan', scanned, referenced, orphans, deleted: 0, errors: 0, backupPath:
    null, orphanRows }`. No snapshot, no write (byte-purity is asserted by the suite).
  - **Apply mode.** `applyCleanup` runs the fail-closed check, computes the orphan set,
    then calls the shared `snapshotAndVerify(tagsDbPath)` (imported from `./import`) and
    only then opens `tags.db` read-write and runs one `db.transaction(() => { … })()`
    executing, for each orphan row,
    `DELETE FROM "tag" WHERE "ownerSub" = ? AND "id" = ?`; returns
    `{ mode: 'apply', scanned, referenced, orphans, deleted: orphans, errors: 0,
    backupPath, orphanRows }`. Any throw propagates (transaction rolls back); no partial
    delete. If `orphans === 0`, no write occurs (the snapshot still captures the pre-apply
    state, matching `import-tags`' unconditional backup).
  - **Report.** `formatCleanupReport` returns exactly
    `` `cleanup-tags [${mode}]: scanned=${scanned} referenced=${referenced} orphans=${orphans} deleted=${deleted} errors=${errors}` ``
    (counts only — never ids, never `name`). `main` then emits one `formatOrphanLine(row)`
    per `report.orphanRows` entry, ascending by `id`. The detail lines are the ONLY place
    ids/`ownerSub` appear; `orphans === orphanRows.length` must hold.
  - **CLI (`scripts/cleanup-tags.ts`).** Mirror `scripts/import-tags.ts`: import `main`
    from `../src/tags/cleanup`; `if (require.main === module) { process.exitCode =
    main(); }`; re-export `main`. Carry the operator header comment (purpose, dry-run
    first, stack-stopped requirement, backup-first, hard line: the human runs it against
    real DBs; agents and tests only ever touch temp fixtures). Do not import
    `reflect-metadata` (no decorators are used) and do not import `redis`/`@life/cache`.
  - **Wiring.** In `apps/tags-service/package.json` scripts, add
    `"cleanup-tags": "ts-node scripts/cleanup-tags.ts"` immediately after the
    `import-tags` line. No dependency changes.
  - **Cache plan (Contract 2).** The script performs no cache read or write and adds no
    `getThrough` call site; the spec's `## Cache Rules` are unchanged. Staleness
    mitigation is decision (a): run with the stack stopped, relying on the documented
    60 s TTL backstop (recorded in T1's section). Failure mode is unchanged: the service's
    own cache remains fail-open and DB-served while no Redis is configured.
  - **Suite (`test/cleanup-tags.test.ts`).** Import `main` from `../scripts/cleanup-tags`
    (the `import-tags` precedent — this is what compiles the CLI under ts-jest) and the
    core (`planCleanup`, `applyCleanup`, `formatCleanupReport`, `formatOrphanLine`,
    `resolvePaths`, the path constants and types) from `../src/tags/cleanup`. Every fixture
    is a throwaway DB under `mkdtempSync`; the suite never opens anything under
    `apps/*/data/**`. Fixture builders:
    - `createTagsDb(path, { tags: Array<{ id: number; ownerSub: string; name?: string }> })`
      with the byte-equivalent registry DDL (`tag` with `id`/`name`/`ownerSub`/`version`/
      `createdAt`). `name` defaults to a non-secret dummy envelope string (`enc.v1.test`);
      the suite asserts the printed report never contains it.
    - `createNoteDb(path, { notes: Array<{ id: string; deletedAt?: string | null }>,
      links: Array<[string, number]> })` with `note` + `note_tag` DDL (post-migration
      shape; no legacy `tag` table, no `user_keys`).
    - `createTodoDb(path, { todos: Array<{ id: string; deletedAt?: string | null }>,
      links: Array<[string, number]> })` with `todo` + `todo_tag` DDL.
    - `envFor(dir, note, todo, tags)` returning
      `{ INIT_CWD: dir, NOTE_DB_PATH: note, TODO_DB_PATH: todo, TAGS_DB_PATH: tags }`
      (deliberately **no** `TAGS_MASTER_KEY`), and a `sha256(path)` helper.
    Required cases (at minimum):
    1. **No orphans:** every registry row is referenced → apply reports
       `scanned=N referenced=N orphans=0 deleted=0 errors=0`; all rows intact.
    2. **An orphan is deleted on apply:** an unreferenced row is gone afterwards; the
       summary line matches `cleanup-tags [apply]: scanned=2 referenced=1 orphans=1
       deleted=1 errors=0`.
    3. **Only a TRASHED note holds a tag → KEPT:** `note.deletedAt` is set and the
       `note_tag` row exists; apply deletes nothing (`orphans=0`).
    4. **Only a TRASHED todo holds a tag → KEPT:** same with `todo.deletedAt`.
    5. **A live note holds a tag → KEPT.**
    6. **Cross-owner isolation:** two owners each hold one referenced and one orphan row;
       apply deletes both orphans and keeps both referenced rows with their `ownerSub`
       intact; the surviving `(id, ownerSub)` set is asserted exactly.
    7. **Dry-run leaves the DB byte-identical:** `sha256` of `tags.db`, `life.db` and
       `todo.db` unchanged; no backup file created; `planCleanup`/`main(['--dry-run'])`
       both report `[plan]` with `deleted=0`.
    8. **Apply writes a verifiable backup:** `applyCleanup`'s `backupPath` exists, opens,
       passes `PRAGMA quick_check` = `ok`, and still contains the orphan (pre-delete
       state).
    9. **Missing `todo.db` → exit 1 and zero deletions:** `main([], { env, … })` returns
       `1`; `printError` names `todo.db`; `sha256(tags.db)` unchanged; no backup created.
    10. **Table-missing DB contributes the empty set:** `life.db` exists with no
        `note_tag` table; a todo reference keeps its tag while the unreferenced tag is
        deleted; exit `0`.
    11. **Legacy `tag` table in `life.db` is not read:** `life.db` carries a legacy `tag`
        row whose id matches an unreferenced registry row that has no `note_tag`/`todo_tag`
        entry → it is deleted (the legacy table is not a reference source).
    12. **No `TAGS_MASTER_KEY` required / no name logged:** the run succeeds with an env
        lacking the key; `main`'s printed lines include `orphan id=<id> owner=<ownerSub>`
        for the orphan row, and the fixture `name` (`enc.v1.test`) appears nowhere in the
        collected `print` output.
    13. **Exact strings:** `formatCleanupReport` yields the plan and apply shapes (counts
        only); `formatOrphanLine({ id: 7, ownerSub: 'sub-a' })` yields
        `orphan id=7 owner=sub-a`.
    14. **Plan and apply agree:** `planCleanup`'s `scanned`/`referenced`/`orphans` equal
        `applyCleanup`'s for the same fixture.
    15. **Default paths regression (string assertions only, no real DB open):**
        `DEFAULT_NOTE_DB_PATH` = `<repoRoot>/apps/note-service/data/life.db`,
        `DEFAULT_TODO_DB_PATH` = `<repoRoot>/apps/todo-service/data/todo.db`,
        `DEFAULT_TAGS_DB_PATH` = `<repoRoot>/apps/tags-service/data/tags.db`, and
        `resolvePaths(env)` returns the env overrides.
    16. **Detail lines: ordering, count, invariant.** With orphan ids created out of order
        (e.g. insert `9` then `2`), `main`'s collected `print` lines are: the summary line
        first, then `orphan id=2 …` before `orphan id=9 …` (ascending `id`); the number of
        detail lines equals `orphans`; and `planCleanup(...).orphans ===
        planCleanup(...).orphanRows.length`.
  - TDD order inside the task: write the suite first and run it to red (modules absent),
    then implement the core + CLI + wiring to green, then refactor with the suite green.

[VERIFICATION & TESTING RULES]
  - Permitted test commands (max test executions: 2):
    `npm run typecheck` (in `apps/tags-service`) and
    `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts`.
  - No full suite, NO E2E (no browser surface is touched), no other spec/workspace.
  - The script must never be run against a real DB by the agent or the Tech Lead; all
    fixtures are temp DBs.
  - Strict constraints: no `getThrough`/Redis import; no `deletedAt` read; no `name`
    read; no `TAGS_MASTER_KEY` load; no raw DDL change; frozen surfaces unchanged;
    `apps/*/data/**` untouched.

[DEFINITION OF DONE]
  - [ ] `cleanup.ts`, `scripts/cleanup-tags.ts`, the `cleanup-tags` npm entry and
        `test/cleanup-tags.test.ts` exist with the exact exported signatures above.
  - [ ] Orphan semantics match the plan: trashed rows keep tags, ids-only output, no
        decryption, fail-closed on a missing file, empty set on a missing table.
  - [ ] Apply snapshots `tags.db` via the shared `snapshotAndVerify` before any delete,
        and deletes per-owner inside one transaction; plan is byte-pure.
  - [ ] No files outside the allowed scope were modified; no Redis/cache use; no
        `apps/*/data/**` access.
  - [ ] `npm run typecheck` in `apps/tags-service` passes with zero errors.
  - [ ] `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` passes.

## Dependency order and parallelization

```
T1 (spec note) ──▶ T2 (core + CLI + wiring + suite) ──▶ Verification gate
```

- T1 is spec-first: it fixes the orphan definition, the trashed-rows rule, the cache
  stance and the sole-writer deviation that T2 implements against; T2 does not start
  before T1's checkpoint.
- T2 is a single cohesion unit: the core logic, the thin CLI and the suite ship together
  because the suite imports `main` from the CLI (the only compile path for `scripts/**`),
  and the npm entry is one line. Splitting them would leave the CLI unverifiable under
  the Project Profile's two commands.
- The Verification gate is last, after T2.

## Deviations / risks

None yet. Every implementation departure from this plan is recorded here with its
rationale before the dependent task proceeds.

## Open Questions

None. The data model, the house script conventions and the cache contract fix every
boundary; the decisions above are encoded, not open.

## Verification gate

Run at the end of T2, before the five-lane gate; every command resolves from the repo
Project Profile. All greps exclude `apps/*/data/**` and `dist/**`.

1. **Project Profile commands:**
   - `npm run typecheck` (in `apps/tags-service`) → exit 0.
   - `npm run test:unit -w @life/tags-service -- test/cleanup-tags.test.ts` → green
     (max 2 executions).
2. **Contract 2 mechanical checks (from `AGENTS.md`, as they apply to a maintenance
   writer):**
   - `grep -rln "getThrough" apps/*/src` → the read flows still go through the
     read-through cache; `cleanup.ts` is not among them (it is a writer, not a read
     flow).
   - `grep -nE "getThrough|redis|@life/cache" apps/tags-service/src/tags/cleanup.ts
     apps/tags-service/scripts/cleanup-tags.ts` → zero hits (the script never touches the
     cache).
   - `grep -rn "## Cache Rules" docs/specs/SPEC-*.md` → the tags-service spec still has
     its section; the maintenance section references it.
   - `grep -n "deletedAt" apps/tags-service/src/tags/cleanup.ts` → zero hits (trashed
     rows count as references).
   - `grep -nE "decrypt|unwrapDek|TAGS_MASTER_KEY|\"name\"|loadMasterKey"` over
     `src/tags/cleanup.ts` + `scripts/cleanup-tags.ts` → zero hits (ids-only, no
     decryption).
   - `grep -n "FROM \"tag\"" apps/tags-service/src/tags/cleanup.ts` → only against
     `tags.db`; the legacy `tag` table in `life.db` is never queried.
3. **Contract 1 mechanical checks:** not applicable — no UI/`packages/ui` surface is
   touched (recorded as "not engaged" in the five-lane report).
4. **Frozen surfaces:** `git status --porcelain apps/*/data` and `git diff --stat` show
   zero changes under `apps/*/data/**`, zero token/e2e/PWA changes, and no modified
   `apps/tags-service/tsconfig.json` or `src/tags/import.ts`.
5. **Five-lane close:** the change closes with the `five-lane-verification` skill: lane 1
   correctness/domain, lane 2 code quality, lane 3 security, lane 4 QA (runs the suite
   gate), lane 5 plan conformance (diff vs this plan and T1's spec section). The gate
   must return **N/N PASS**; any lane FAIL → fix its blockers → re-run only the failed
   lanes → repeat until N/N PASS. No partial verdict is treated as done, committed, or
   merged. Merge to `master` still requires the user's explicit request.
