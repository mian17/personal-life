# Task Ledger: feedback (feedback-infra → feedback-service → feedback-ui)

Plan: `tasks/plan-feedback.md` · Map + specs: `docs/specs/MAP-feedback.md` +
`SPEC-{feedback-infra,feedback-service,feedback-ui}.md` · Intent: `docs/intent/feedback-service.md`.

Branch: `feat/app-feedback`. Process: global protocol (`~/.config/opencode/AGENTS.md`) §3
(testing policy), §5 (task template), §6 (plan-validation gate), §7 (review), §7.6
(five-lane for feature work) + this repo's `AGENTS.md` Project Profile/Contracts. Each task
= one subagent (mandatory §5 template), tech-lead diff review + commit (Blast Radius +
Contract + Project Contract checks + execution audit). Targeted tests, ≤2 executions per
task (profile `max-test-runs`), exactly ONE targeted e2e run in the whole chapter (T14).
No full suites, no unqualified runners. Merge to `master` on the user's explicit request
only. Frozen surfaces (e2e selectors, token values, existing PWA constants) are untouched.

Shared-build precondition (stated once; referenced by T7–T15): consumers resolve
`@life/shared` through `node_modules` to `packages/shared/dist/index.d.ts`, and
`npm run typecheck -w @life/shared` never emits `dist` — so run `npm run build -w @life/shared`
before any downstream `npm run typecheck -w @life/feedback-service`, `-w @life/ui`, or
`-w @life/app`.

## Tasks

- [ ] T1: Governing-docs reconciliation — module `feedback-infra` (cross-chapter)
  - [TASK OBJECTIVE] Revise the two governing docs so the broker + Postgres decision is a
    recorded cross-chapter change before any infra code lands (intent 8, lesson 0012).
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `docs/intent/architecture.md`, `docs/specs/MAP-redis.md`.
    - Reference files (read-only): `docs/intent/feedback-service.md` (decision 8),
      `docs/specs/SPEC-feedback-infra.md`, `docs/specs/MAP-feedback.md`,
      `docs/lessons/0012-cross-chapter-invariants.md`.
    - Strictly prohibited files: every file not listed above (no code, no other doc).
  - [IMPLEMENTATION REQUIREMENTS]
    - `docs/intent/architecture.md`: record that the "Multi-host orchestration (k8s, service
      mesh, message brokers) until a real need shows up" line (line 37) and the SQLite
      posture (lines 43, 52) are revised **deliberately** for the feedback chapter: feedback
      is the need that earns the first Postgres store and the first broker (RabbitMQ), and
      the existing four services stay on SQLite. Phrase it as an explicit revision of the
      earlier decision (per lesson 0012), not a local restatement: name the chapter, the two
      new components, and the reason. No code paths, no secrets.
    - `docs/specs/MAP-redis.md`: add `redis-feedback` to the per-service roster — its own
      instance (never shared, intent decision 3 / lesson 0011), read-through cache for
      `feedback-service`, `REDIS_URL` as elsewhere; note it is provisioned by the feedback
      chapter alongside `redis-<service>`.
    - No other decision in either file is re-opened.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: none (docs-only task; no test execution, no typecheck).
    - Verification greps: `grep -n "feedback" docs/specs/MAP-redis.md` non-empty and
      `grep -ni "rabbitmq\|postgres" docs/intent/architecture.md` non-empty.
    - Strict constraints: NO full suites, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `architecture.md` records the revision explicitly (chapter, Postgres + broker
          earned their place, existing services stay SQLite).
    - [ ] `MAP-redis.md` lists `redis-feedback` as its own per-service instance.
    - [ ] Both verification greps non-empty; no file outside scope modified.
  - Dependencies: none. Size: S.

- [ ] T2: compose infra — module `feedback-infra`
  - [TASK OBJECTIVE] Add the `postgres`, `rabbitmq`, and `redis-feedback` compose services
    with named volumes, healthchecks, and the confirmed publish policy (`postgres`/
    `rabbitmq` publish host loopback `127.0.0.1:5432:5432`/`127.0.0.1:5672:5672`;
    `redis-feedback` publishes none), plus the two password names in `.env.example`.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `compose.yaml`, `.env.example`.
    - Reference files (read-only): `docs/specs/SPEC-feedback-infra.md` (`## compose.yaml
      additions`), `compose.yaml` (the five existing Redis instances, lines ~227-356, and
      the bottom `volumes:` block), `docs/specs/MAP-redis.md`.
    - Strictly prohibited files: everything else — NOT `.env.development.example` (T10's per P1; T2
      owns only `.env.example`), NOT the `feedback-service` compose block (T10's), NOT `apps/**`.
  - [IMPLEMENTATION REQUIREMENTS]
    - `postgres`: image `postgres:17-alpine`; `POSTGRES_DB: feedback`; `POSTGRES_USER:
      feedback`; `POSTGRES_PASSWORD: ${FEEDBACK_DB_PASSWORD:?FEEDBACK_DB_PASSWORD is
      required}` (fail-fast, the `NOTE_MASTER_KEY` pattern); volume
      `postgres-data:/var/lib/postgresql/data`; joins the existing `life` network; the
      healthcheck from the spec (`pg_isready -U feedback -d feedback`, interval 10s,
      timeout 3s, retries 5, start_period 10s); `restart: unless-stopped`; **`ports:`
      `127.0.0.1:5432:5432`** — host loopback only (the `app`/`idp` comment pattern, so the
      host-run dev service on 3108 reaches it; production stays `postgres:5432`).
    - `rabbitmq`: image `rabbitmq:4.1-alpine` (confirm the minor tag against Docker Hub at
      implementation); `RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-feedback}`;
      `RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:?RABBITMQ_PASSWORD is required}`; volume
      `rabbitmq-data:/var/lib/rabbitmq`; the `rabbitmq-diagnostics -q ping` healthcheck;
      `restart: unless-stopped`; **`ports:` `127.0.0.1:5672:5672`** — host loopback only
      (dev reachability on 3108; production stays `rabbitmq:5672`); network `life`.
      The management UI stays off: image without `-management`, `15672` never published.
    - `redis-feedback`: a sixth internal-only Redis instance mirroring the existing five
      exactly (same image/tag, `redis-feedback-data` named volume, `life` network, same
      healthcheck, no host ports) — its own instance, never a namespaced tenant
      (lesson 0011). No other service points at it.
    - Bottom `volumes:` block gains `postgres-data:`, `rabbitmq-data:`, `redis-feedback-data:`.
    - `.env.example` gains the two documented **names** (values never committed), matching
      the `NOTE_MASTER_KEY` comment style: `FEEDBACK_DB_PASSWORD=` and `RABBITMQ_PASSWORD=`.
      No `FEEDBACK_MASTER_KEY`/`FEEDBACK_API_URL` here (T10 owns service wiring), no
      `.env.development.example` change in this task.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `docker compose config` (config validation only — no `up`, no
      build, no test suite). Do NOT run the stack; the tech lead brings the three services
      up once at the Infra checkpoint.
    - Strict constraints: NO full suites, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `docker compose config` parses and shows the three services with named volumes,
          healthchecks, `postgres`/`rabbitmq` publishing host loopback only
          (`127.0.0.1:5432:5432`/`127.0.0.1:5672:5672`), `redis-feedback` publishing none.
    - [ ] `.env.example` documents both password names; `.env.development.example` untouched by this task (T10's per P1).
    - [ ] No `feedback-service` compose block added; no file outside scope modified.
  - Dependencies: T1. Size: S.

- [ ] T3: `PgRunner` seam — module `feedback-infra`
  - [TASK OBJECTIVE] Implement the Postgres client seam (`PgRunner`) that runs every
    `pg_dump`/`pg_restore`/`psql` call inside a container, with URL parsing and the
    dump/verify/table-count helpers the backup/restore cores consume.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/db/src/pg-client.ts` (new),
      `packages/db/src/backup.ts` (one additive `export` on the existing `readManifest` —
      SQLite/Postgres parity; T4/T5s' unit suites assert the same manifest-less exclusion),
      `packages/db/src/index.ts` (re-export `PgRunner`, `createComposePgRunner`,
      `createDockerPgRunner`).
    - Reference files (read-only): `docs/specs/SPEC-feedback-infra.md`
      (`### The client inside the container`), `packages/db/src/backup.ts`
      (`pruneRoutineSnapshots` — reused unchanged; `readManifest` — import the export,
      never copy),
      `packages/db/src/backup.ts`/`restore.ts` (the SQLite probe/build shape),
      `docs/specs/SPEC-db-backup-restore.md` (the mirrored contract).
    - Strictly prohibited files: `packages/db/src/backup-pg.ts`/`restore-pg.ts` (T4/T5),
      `packages/db/scripts/**` (T4/T5), `compose.yaml`, `package.json` (T4/T5).
  - [IMPLEMENTATION REQUIREMENTS]
    - Export the spec's interface exactly:
      ```ts
      export interface PgRunner {
        exec(argv: string[]): { status: number; stdout: string; stderr: string };
        copyIn(hostPath: string, containerPath: string): void;
        copyOut(containerPath: string, hostPath: string): void;
      }
      ```
    - `createComposePgRunner({ composeFile, service: 'postgres' })`: runs
      `docker compose -f <repo-anchored compose.yaml> exec -T postgres …` and
      `docker compose -f <compose.yaml> cp …`; `-T` disables TTY (nothing reads stdin).
    - `createDockerPgRunner(containerName)`: `docker exec …` / `docker cp …` (the
      integration harness).
    - URL parsing via `new URL(FEEDBACK_DB_URL)` into `{ user, database }`; the URL is the
      single source of database identity (host/port/password intentionally unused — the
      client runs over the container's local socket).
    - Helpers (types, no `any`): `pgDump(containerPath, database)`,
      `pgRestoreListOk(containerPath)` (`pg_restore --list` exit 0),
      `tableCounts(database)` → `Record<tableName, rowCount>` for every base table in
      `public`, and the restore-side `replaceDatabase(database, containerPath)` helper
      (`DROP DATABASE IF EXISTS …; CREATE DATABASE … OWNER …; pg_restore --no-owner -d …`).
    - `packages/db/src/backup.ts`: add the `export` keyword to the existing `readManifest`
      (one-word diff, no logic change) so the PG restore core reads pre-restore manifests
      through it instead of reimplementing; `pruneRoutineSnapshots` stays an import.
    - Default URL when unset: `postgresql://feedback@postgres:5432/feedback`. Secrets never
      appear in argv or logs (A7).
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run typecheck -w packages/db`.
    - Strict constraints: NO full suites, NO E2E; typecheck only (behavior is T4/T5's
      suites); max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `PgRunner` + both factories + the listed helpers exist exactly as typed; no `any`.
    - [ ] `packages/db/src/index.ts` re-exports the seam; `readManifest` is exported
          (SQLite/Postgres parity — the PG restore core uses it via import in T5);
          `npm run typecheck -w packages/db` passes; no file outside scope modified.
  - Dependencies: T2 (compose service name is referenced). Size: M.

- [ ] T4: `db:backup:pg` — module `feedback-infra`
  - [TASK OBJECTIVE] Implement the routine/deliberate Postgres backup core and its thin CLI,
    proven by a fake-runner unit suite, and wire both package scripts.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/db/src/backup-pg.ts` (new),
      `packages/db/scripts/backup-pg.ts` (new), `packages/db/test/backup-pg.test.ts` (new),
      `packages/db/package.json` (`"db:backup:pg": "ts-node scripts/backup-pg.ts"`),
      `package.json` (root: `"db:backup:pg": "npm run db:backup:pg -w @life/db --"`).
    - Reference files (read-only): `packages/db/src/pg-client.ts` (T3),
      `packages/db/src/backup.ts` (`pruneRoutineSnapshots` — **reused unchanged**),
      `packages/db/scripts/backup.ts` (thin-entry shape, `process.exitCode = main()`),
      `docs/specs/SPEC-feedback-infra.md` (`### Backup behavior`, `### Naming, manifest,
      retention`, `### Exit codes`).
    - Strictly prohibited files: `pg-client.ts` (T3), restore files (T5),
      `src/index.ts` (T5 adds the `run*` re-exports), `compose.yaml`, `apps/**`, tests of T5.
  - [IMPLEMENTATION REQUIREMENTS]
    - `runBackupPg({ argv, env, runner, now })` implementing the spec's numbered steps:
      resolve URL (from `env`, explicit — never a test var); parse `--only` (unknown → exit 1
      before any write) and `--pin`; compute the stamp
      `new Date().toISOString().replace(/[:.]/g, '-')` relative to `INIT_CWD ?? cwd`; refuse
      an existing destination; `pg_dump -Fc --no-owner` inside the container to a unique
      `/tmp/db-backup-<stamp>/<db>.dump`; verify with `pg_restore --list`; record per-table
      counts; `copyOut` to `backup/<stamp>/<db>.dump` (`--pin` → `…-pinned/` +
      `PINNED` marker); write `manifest.json` with the SQLite top-level shape
      (`mode`, `createdAt`, `pinned`, `databases[]`) and each entry
      `{ name, file, source, bytes, pgRestoreList: 'ok', tables }`; apply
      `pruneRoutineSnapshots(backupRoot)` on routine runs only; print one line per database.
    - `--only` maps to Postgres database names; the only valid v1 value is the URL's
      database (`feedback`); archived file `<database>.dump`.
    - Thin entry sets `process.exitCode = main()`; no `process.exit`, no prompt, no stdin.
    - Unit tests: temp fixture dirs (`mkdtempSync`) + a fake `PgRunner` recording argv and
      returning canned stdout — **never Docker**. Cover: stamp/`-pinned` naming; manifest
      shape (`pgRestoreList: 'ok'`, `tables`); `--pin` writes `PINNED` and is
      distinguishable by name + manifest; unknown `--only` exits 1 before any write;
      retention prunes routine to newest 10 and never prunes pinned/deliberate/
      pre-restore/manifest-less dirs; `--only feedback` accepted, file `feedback.dump`;
      exit codes deterministic across repeated identical runs.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run typecheck -w packages/db` and
      `npm run test:unit -w packages/db -- test/backup-pg.test.ts`.
    - Strict constraints: NO full suites, NO E2E; only this named file; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `runBackupPg` matches the spec's steps; the entry sets `process.exitCode`.
    - [ ] Both scripts (`packages/db/package.json`, root `package.json`) exist exactly as
          specified; `pruneRoutineSnapshots` is imported, not forked.
    - [ ] Unit suite covers every listed case; typecheck + the named suite pass.
    - [ ] No file outside scope modified.
  - Dependencies: T3. Size: M.

- [ ] T5: `db:restore:pg` + integration — module `feedback-infra`
  - [TASK OBJECTIVE] Implement the restore core with its fail-closed preconditions and
    post-write verification, its thin CLI, the fake-runner unit suite, and the
    throwaway-container integration suite.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/db/src/restore-pg.ts` (new),
      `packages/db/scripts/restore-pg.ts` (new), `packages/db/test/restore-pg.test.ts` (new),
      `packages/db/test/pg-integration.test.ts` (new),
      `packages/db/src/index.ts` (re-export `runBackupPg`, `runRestorePg` — completes T3's
      seam re-exports), `packages/db/package.json`
      (`"db:restore:pg": "ts-node scripts/restore-pg.ts"`),
      `package.json` (root: `"db:restore:pg": "npm run db:restore:pg -w @life/db --"`).
    - Reference files (read-only): `packages/db/src/pg-client.ts` (T3),
      `packages/db/src/backup-pg.ts` (T4 manifest shape), `packages/db/src/backup.ts`
      (`readManifest`), `packages/db/scripts/restore.ts` (thin-entry shape),
      `docs/specs/SPEC-feedback-infra.md` (`### Restore behavior`, `### Restore safety
      check`, `## Testing Strategy`).
    - Strictly prohibited files: `src/pg-client.ts`, `src/backup-pg.ts`, `compose.yaml`,
      `apps/**`.
  - [IMPLEMENTATION REQUIREMENTS]
    - `runRestorePg({ from, only, env, runner, probe, now })` implementing the spec:
      parse `--from` (required; under `backup/`, resolved against `INIT_CWD ?? cwd`; an
      absolute/escaping path exits 1) and `--only`; **before any write** verify the
      `*.dump` exists and `pg_restore --list` says ok (else exit 1) and the injected
      `probe` reports the stack stopped (up or unknown → exit 2, touching nothing);
      take a verified pinned pre-restore snapshot into
      `backup/pre-restore-<stamp>/feedback.dump` (+ `manifest.json`, `mode: pre-restore`,
      `pinned: true`, `PINNED`); replace the live DB via the T3 `replaceDatabase` helper;
      post-write compare each restored table's count against the snapshot manifest's
      `tables` — mismatch exits 1 and prints
      `recover from backup/pre-restore-<stamp>/feedback.dump`; success prints one line per
      restored database.
    - The snapshot `manifest.json` is read with the exported `readManifest` from
      `packages/db/src/backup.ts` (import, never a local copy — SQLite/Postgres parity);
      an unreadable/missing manifest is fail-safe: skip the count comparison rather than
      guess, never crash the restore.
    - The probe is per the spec: TCP to `127.0.0.1:3002`/`3003` and the DB-native
      other-backend count (`pg_stat_activity … pid <> pg_backend_pid()`); fails closed on
      any `up`/`unknown`.
    - Thin entry sets `process.exitCode = main()`; non-interactive; no prompt, no stdin.
    - Unit tests (fake runner + injected probe, no Docker): probe `up`/`unknown` → exit 2
      and nothing replaced; `--from` outside `backup/` → exit 1; failing `pg_restore --list`
      → exit 1 and nothing replaced; a verified pre-restore snapshot is taken before the
      target is dropped; a row-count mismatch → exit 1 and names the recovery path;
      `--only` restores the subset; missing `--from` → exit 1; stdin closed → no prompt,
      no hang; exit codes deterministic.
    - `pg-integration.test.ts`: `beforeAll` starts a throwaway Postgres
      (`docker run --rm -d --name feedback-pg-test -e POSTGRES_USER=postgres
      -e POSTGRES_PASSWORD=… -e POSTGRES_DB=feedback postgres:17-alpine`), waits for
      `pg_isready`, uses `createDockerPgRunner('feedback-pg-test')`; seeds a table, backs
      it up, mutates, restores, asserts the prior state returns (undo proof) and the
      restored counts match the manifest; `afterAll` force-removes the container. Skipped,
      not failed, when Docker is unavailable; never touches `apps/*/data` or the production
      compose services. When `FEEDBACK_TEST_DB_URL` is set it may point the harness at an
      already-running throwaway instead of starting one.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run typecheck -w packages/db`,
      `npm run test:unit -w packages/db -- test/restore-pg.test.ts`, and
      `npm run test:unit -w packages/db -- test/pg-integration.test.ts` (skipped when
      Docker is absent).
    - Strict constraints: NO full suites, NO E2E; only these named files; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `runRestorePg` matches the spec's steps; every precondition fails closed before
          the target is touched; the pre-restore snapshot is pinned and verified.
    - [ ] Integration suite proves the undo path and count parity (or skips cleanly).
    - [ ] Both scripts exist exactly as specified; `src/index.ts` re-exports
          `runBackupPg` + `runRestorePg`; `grep -rni "redis" packages/db/src` → zero hits.
    - [ ] Typecheck + both suites pass; no file outside scope modified.
  - Dependencies: T4. Size: M.

- [ ] T6: `@life/shared` feedback wire types — module `feedback-service`
  - [TASK OBJECTIVE] Add the feedback wire types to `@life/shared` as the single home shared
    by the service, the BFF, and the UI blocks.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/shared/src/index.ts`.
    - Reference files (read-only): `docs/specs/MAP-feedback.md` (`### Service HTTP contract`),
      `docs/specs/SPEC-feedback-service.md` (`## API / DTO contract`),
      `docs/specs/SPEC-feedback-ui.md` (`## Tech Stack`, `### Component contracts`),
      `packages/shared/src/index.ts` (the `Todo`/`TODO_REPEATS` precedent).
    - Strictly prohibited files: every file not listed (no service, no ui, no app).
  - [IMPLEMENTATION REQUIREMENTS]
    - `export const FEEDBACK_TYPE_VALUES = ['feature_request', 'enhancement', 'bug_report'] as const;`
      and `export type FeedbackType = (typeof FEEDBACK_TYPE_VALUES)[number];`.
    - `export const FEEDBACK_APPS = ['notes', 'todos', 'feedback'] as const;` and
      `export type FeedbackApp = (typeof FEEDBACK_APPS)[number];` (the submit-side known-app
      set the service validates against).
    - `export const FEEDBACK_DESCRIPTION_MAX = 2000;`.
    - `export interface FeedbackDto { id: string; app: string; type: string; description: string; createdAt: string; }`
      — `app`/`type` are `string` so an id from a future app/type renders as itself
      (forward compatibility, SPEC-feedback-ui grouping).
    - `export interface CreateFeedbackInput { id: string; app: FeedbackApp; type: FeedbackType; description: string; }`.
    - `export type FeedbackSubmitResult = { ok: true; id: string } | { ok: false; message: string };`.
    - No other signature changes; no runtime dependency added.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run typecheck -w @life/shared` then
      `npm run build -w @life/shared` (the shared-build precondition for every downstream
      task).
    - Strict constraints: NO full suites, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Every listed export exists exactly as typed; no `any`.
    - [ ] `npm run typecheck -w @life/shared` and `npm run build -w @life/shared` pass;
          no file outside scope modified.
  - Dependencies: T1. Size: S.

- [ ] T7: `apps/feedback-service` kernel-copy scaffold — module `feedback-service`
  - [TASK OBJECTIVE] Stand up a bootable, guarded NestJS workspace by copying the
    note-service kernel (bootstrap, global guard + validation, health dialect, key custody),
    registering it in the root workspace.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/feedback-service/**` (new: `package.json` with
      `build`/`typecheck`/`test:unit` scripts + jest config resolving `@life/*` from source,
      `tsconfig.json`, `nest-cli.json`, `src/main.ts` (binds `PORT` default 3008),
      `src/app.factory.ts` (`createApp()`: global `AuthGuard` + global
      `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`),
      `src/app.module.ts` (`TypeOrmModule.forRoot({ type: 'postgres', url:
      FEEDBACK_DB_URL, entities: [...], synchronize: true })`), `src/auth/**` (AuthGuard +
      jwt-verifier + principal + `@Public()` exempting the health trio only — kernel copy:
      offline JWKS, 30s skew, `IDP_ISSUER` + `FEEDBACK_IDP_JWKS_URL`, `aud=FEEDBACK_SERVICE_AUDIENCE`, fail closed),
      `src/health/**` (`/health/live`, `/health/ready` (DB + key-custody config only — never
      Redis/RabbitMQ, side-effect-free), `/health` alias)), root `package.json` (workspaces
      += `apps/feedback-service`), `package-lock.json` (via `npm install` only).
      Adds dependency `pg` (TypeORM postgres driver).
    - Reference files (read-only): `apps/note-service/**` (the kernel to copy),
      `apps/todo-service/**` (a second kernel copy + `package.json` script shape),
      `docs/specs/SPEC-feedback-service.md` (`## Project Structure`, `## Commands`),
      `apps/feedback-service/package.json` does not exist yet.
    - Strictly prohibited files: `apps/note-service/**`, `apps/todo-service/**`,
      `compose.yaml`, `.env*`, `docs/**`, and the T8/T9 modules (`src/feedback/**`,
      `src/event/**`).
  - [IMPLEMENTATION REQUIREMENTS]
    - Kernel only — no feedback/event module yet. `app.module.ts` registers the health
      controller + the global guard; `synchronize: true` with an empty entity set is fine at
      this step (T8/T9 add entities). The service refuses to boot without `FEEDBACK_DB_URL`,
      `FEEDBACK_MASTER_KEY`, or the verifier config (kernel fail-closed rule).
    - Health dialect exactly the kernel's: `/health/live` 200 with the DB down;
      `/health/ready` 503 on DB down or missing key custody; `/health` aliases readiness.
      The readiness custody check is a side-effect-free config-presence check (the idp
      lesson) — it must not trigger lazy key generation.
    - `package.json` scripts: `"build": "nest build"`, `"typecheck": "tsc -p tsconfig.json
      --noEmit"`, `"test:unit": "jest"` (mirror the sibling services); jest
      `moduleNameMapper` resolves `@life/shared`/`@life/crypto`/`@life/cache` to their
      `src/index.ts` (the note/todo precedent — types resolve from `dist/` for tsc).
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` (the shared-build precondition) then
      `npm run typecheck -w @life/feedback-service` and
      `npm run build -w @life/feedback-service`.
    - Strict constraints: NO full suites, NO E2E (behavior/health suites are T10); typecheck
      + build only; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The workspace builds and typechecks; `PORT` defaults to 3008; the global guard +
          whitelist pipe are wired; the health trio answers per the kernel dialect.
    - [ ] Root `package.json` workspaces includes `apps/feedback-service`; lockfile updated
          via `npm install`; no file outside scope modified.
  - Dependencies: T6 (shared types) + T1. Size: L (a kernel-copy scaffold; the reference
    ledgers sized the same workspace-copy tasks L).

- [ ] T8: feedback API slice — module `feedback-service`
  - [TASK OBJECTIVE] Deliver the owner-scoped write + read vertical slice: `POST`/`GET
    /api/feedback` behind the read-through cache with `enc.v1.` at rest.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/feedback-service/src/feedback/feedback.entity.ts`
      (new), `apps/feedback-service/src/feedback/feedback-event.entity.ts` (new — the
      `feedback_event` table is written in the same transaction; its dispatcher side is
      T9), `apps/feedback-service/src/feedback/feedback-cursor.entity.ts` (new — the
      singleton cursor row), `apps/feedback-service/src/feedback/feedback-cache.ts` (new),
      `apps/feedback-service/src/feedback/feedback.service.ts` (new),
      `apps/feedback-service/src/feedback/feedback.controller.ts` (new),
      `apps/feedback-service/src/feedback/dto/create-feedback.dto.ts` (new),
      `apps/feedback-service/src/feedback/feedback.module.ts` (new),
      `apps/feedback-service/src/app.module.ts` (register the module + entities),
      `apps/feedback-service/src/keys/**` (DEK provisioning, notes-at-rest pattern — if T7
      left it minimal).
    - Reference files (read-only): `apps/note-service/src/notes/notes-cache.ts` +
      `notes.service.ts` (the reference implementation), `apps/note-service/src/notes/
      dto/**`, `docs/specs/SPEC-feedback-service.md` (`## Data model`, `## API / DTO
      contract`, `## Cache Rules`, `## Code Style`), `packages/shared/src/index.ts`.
    - Strictly prohibited files: `src/feedback/feedback-event.entity.ts` is **created here**
      but its trigger/dispatcher consumer is T9; no `src/event/**` (T9), no tests (T10),
      no `compose.yaml`.
  - [IMPLEMENTATION REQUIREMENTS]
    - **Cache plan (Contract 2 Rule 4, fulfils SPEC-feedback-service `## Cache Rules`):**
      cached shape = the owner's full `feedback` row set serialized exactly as stored
      (`description` an `enc.v1.` envelope); key `feedback:<owner_sub>:v<gen>:list`
      (filters/pagination never in the key); invalidation = per-owner generation counter
      `feedback:gen:<owner_sub>` `INCR` **after** every successful write (a thrown
      transaction never bumps); 60s TTL backstop; fail-open on any cache error; decrypt +
      assemble DTOs + order newest-first **after** every hit; `decode`/`cacheable` reject any
      non-`enc.v1.` entry so plaintext never lands in Redis. Read path uses
      `@life/cache`'s `getThrough`; `REDIS_URL` unset → direct loader.
    - Entities (`synchronize: true`, additive): `feedback(id UUID PK client-supplied,
      owner_sub TEXT, app TEXT, type TEXT CHECK IN the three values, description TEXT
      (enc.v1. envelope), created_at TIMESTAMPTZ DEFAULT now())` + `IDX_feedback_owner_created
      (owner_sub, created_at DESC, id DESC)`; `feedback_event(seq BIGSERIAL PK, event_id
      UUID UNIQUE, feedback_id UUID REFERENCES feedback(id), owner_sub, app, type,
      occurred_at, dispatched_at NULL)`; `feedback_cursor(id TEXT PK DEFAULT 'feedback',
      last_seq BIGINT DEFAULT 0)`. `event_id = feedback.id`, `occurred_at = now()`;
      description AAD `life.v1|<sub>|feedback|description|<id>`.
    - `CreateFeedbackDto` (class-validator): `@IsUUID('4') id`, `@IsString() @IsIn(FEEDBACK_APPS)
      app`, `@IsIn(FEEDBACK_TYPE_VALUES) type`, `@IsNotEmpty() @MaxLength(FEEDBACK_DESCRIPTION_MAX)
      description` — mirrors shared `CreateFeedbackInput`; the description is trimmed and
      non-empty after trim. Wire types are imported from `@life/shared`, never redeclared.
    - `POST /api/feedback`: owner from `principal.sub` (never the body); insert `feedback` +
      `feedback_event` in ONE transaction; bump the owner's generation after commit; return
      `201 { id }`. A repeat of an already-owned `id` → same no-op `201 { id }` (catch the
      unique violation / pre-check) — **never `409`**. An `id` owned by another `sub` or
      missing → `404` byte-identical to missing. Validation failure → `400` (never `422`).
    - `GET /api/feedback`: owner-scoped, `200` bare `FeedbackDto[]` (no envelope) ordered
      `createdAt DESC, id DESC` via the cache read path; decrypt in the request path only.
    - `optional` Redis (dev/e2e) must degrade to the direct loader without writing
      plaintext (Contract 2).
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` then
      `npm run typecheck -w @life/feedback-service`.
    - Strict constraints: NO full suites, NO E2E (behavior is T10); typecheck only; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The two routes exist under `/api/feedback` with the locked status semantics
          (`201`/`404`/`400`; never `409`/`422`); the read-through cache + generation bump +
          ciphertext-only discipline are implemented per the `## Cache Rules` section.
    - [ ] `npm run typecheck -w @life/feedback-service` passes; no file outside scope.
  - Dependencies: T7. Size: M.

- [ ] T9: event slice — module `feedback-service`
  - [TASK OBJECTIVE] Deliver the durable event path: boot-ensured NOTIFY trigger, persistent
    `LISTEN` dispatcher with cursor + reconciliation tick, and the confirmed RabbitMQ
    publisher.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/feedback-service/src/event/trigger-ddl.ts` (new —
      the boot-ensured `CREATE OR REPLACE FUNCTION notify_feedback()` + `DROP/CREATE TRIGGER
      feedback_notify AFTER INSERT ON feedback_event` issuing `pg_notify('feedback_events',
      json_build_object('seq', NEW.seq, 'event_id', NEW.event_id)::text)`),
      `apps/feedback-service/src/event/dispatcher.service.ts` (new),
      `apps/feedback-service/src/event/publisher.service.ts` (new),
      `apps/feedback-service/src/event/event.module.ts` (new),
      `apps/feedback-service/src/app.module.ts` (register `EventModule`; ensure the trigger
      DDL runs at boot),
      `apps/feedback-service/package.json` + `package-lock.json` (add `amqplib` +
      `@types/amqplib`).
    - Reference files (read-only): `apps/feedback-service/src/feedback/*` (T8 entities +
      transaction), `docs/specs/SPEC-feedback-service.md` (`## Event stream`, `## Tech
      Stack`), `packages/cache/src/index.ts` (generation bump — untouched here).
    - Strictly prohibited files: `src/feedback/**` (T8), tests (T10), `compose.yaml` (T10),
      `apps/app/**`.
  - [IMPLEMENTATION REQUIREMENTS]
    - Trigger DDL is ensured at boot (no migration framework) exactly as the spec's SQL;
      payload stays `seq` + `event_id`.
    - Dispatcher: one persistent `LISTEN feedback_events` connection (push, immediate). On
      notify load the event row by `seq`, hand to the publisher, and on publish confirm
      advance `feedback_cursor.last_seq` and stamp `dispatched_at`; **cursor advance happens
      only after the broker confirm**.
    - Recovery on startup/reconnect: bounded ordered change-log read
      `SELECT * FROM feedback_event WHERE seq > :last_seq ORDER BY seq ASC LIMIT <batch>`,
      publishing in order, then resume on notifications. Never a scan of `feedback`.
    - Reconciliation tick**: every 60s compare `SELECT MAX(seq) FROM feedback_event` with
      `last_seq`; if behind, replay the same bounded cursor walk until caught up (the
      backstop for a transient/dropped NOTIFY). No `WHERE dispatched_at IS NULL` query over
      `feedback`.
    - Publisher: confirm channel on durable topic exchange `feedback`; persistent messages,
      routing key `feedback.submitted`, body `{ event_id, feedback_id, owner_sub, app, type,
      occurred_at }` — never the plaintext or ciphertext description; wait for the publisher
      confirm before reporting success. Publisher sits behind a small interface so tests can
      inject a fake sink recording confirms.
    - Failure mode: RabbitMQ down never affects the HTTP path (writes keep committing, the
      log keeps events); the dispatcher reconnects with backoff and replays from the cursor.
      `/health/ready` still checks DB + key custody only (never RabbitMQ).
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` then
      `npm run typecheck -w @life/feedback-service` and
      `npm run build -w @life/feedback-service`.
    - Strict constraints: NO full suites, NO E2E (the path is proven in T10); typecheck +
      build only; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Trigger DDL ensured at boot; dispatcher listens, publishes, advances the cursor
          only after confirm, and replays by `seq` on start/reconnect; the 60s tick replays a
          dropped notification; no business-row scan exists.
    - [ ] `amqplib` added to `package.json` + lockfile via `npm install`; typecheck + build
          pass; no file outside scope modified.
  - Dependencies: T8. Size: M.

- [ ] T10: service test suites + wiring — module `feedback-service`
  - [TASK OBJECTIVE] Prove the spec's seven behavior groups against a throwaway Postgres,
    then wire the service into compose/env/README with its Dockerfile.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/feedback-service/test/feedback.e2e-spec.ts` (new),
      `apps/feedback-service/test/feedback-events.e2e-spec.ts` (new),
      `apps/feedback-service/test/health.e2e-spec.ts` (new),
      `apps/feedback-service/test/feedback-harness.ts` (new — throwaway-Postgres bootstrap
      via `FEEDBACK_TEST_DB_URL`, skipped when Docker is absent, fake cache/AMQP seams),
      `apps/feedback-service/Dockerfile` (new — per-workspace explicit `COPY … package.json`
      lines, mirroring the sibling services), `compose.yaml` (add the `feedback-service`
      service block: build, `depends_on` healthy for `postgres`/`rabbitmq`/`redis-feedback`,
      env `FEEDBACK_DB_URL: postgresql://feedback:${FEEDBACK_DB_PASSWORD}@postgres:5432/feedback`,
      `RABBITMQ_URL: amqp://feedback:${RABBITMQ_PASSWORD}@rabbitmq:5672`,
      `REDIS_URL: redis://redis-feedback:6379`, fail-fast `FEEDBACK_MASTER_KEY`, the verifier
      pair `IDP_ISSUER: ${IDP_ISSUER:-}` +
      `FEEDBACK_IDP_JWKS_URL: ${FEEDBACK_IDP_JWKS_URL:-http://idp:3003/jwks}` (the
      copied verifier throws without `IDP_ISSUER` — fail closed, so a compose-launched
      service never boots half-configured), `FEEDBACK_SERVICE_AUDIENCE`,
      `PORT: 3008` (prod/container; dev runs 3108); healthcheck
      `/health/ready`; the `app` service gains `FEEDBACK_API_URL: http://feedback-service:3008`
      (sibling `TODO_API_URL: http://todo-service:3005` pattern; internal-only, no published
      host port)),
      `.env.example` (`FEEDBACK_MASTER_KEY=` documented — sibling parity; master keys only,
      no `*_API_URL` names belong there),
      `.env.development.example` (dev wiring per P1: `FEEDBACK_API_URL=http://127.0.0.1:3108`
      next to `TODO_API_URL=http://127.0.0.1:3105`, plus the commented `FEEDBACK_DB_URL` /
      `FEEDBACK_MASTER_KEY` names a dev run needs), root `package.json` (the `dev` script
      gains `"PORT=3108 npm run dev -w apps/feedback-service"` next to the tags `3104` /
      todo `3105` entries), `README.md` (services/ports + the P1 dev note),
      `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`,
      `apps/tags-service/Dockerfile`, `apps/todo-service/Dockerfile` (add the new
      `apps/feedback-service/package.json` to their explicit manifest `COPY` sets so
      `npm ci` resolves the workspace), `package-lock.json` (via `npm install` only).
    - Reference files (read-only): `apps/todo-service/Dockerfile` + `compose.yaml` (the
      tags/todo wiring precedent), `apps/app/Dockerfile`, `docs/specs/SPEC-feedback-service.md`
      (`## Testing Strategy`, seven groups), `docs/specs/SPEC-feedback-infra.md`
      (`### compose.yaml additions`, `## Hard lines`).
    - Strictly prohibited files: service `src/**` (a failing test re-opens T7/T8/T9),
      `apps/app/test/e2e/**` (T14).
  - [IMPLEMENTATION REQUIREMENTS]
    - Suites cover the spec's seven groups: (1) idempotency — same `id` twice → one
      `feedback` row + one `feedback_event` row, both `201 { id }`; another owner's `id` →
      `404`; (2) transactional log — commit fires the real trigger (a real `LISTEN`
      receives `seq`+`event_id`), a rolled-back insert notifies nothing; (3) dispatcher —
      notify → publish (fake AMQP sink recording confirms) → cursor advances; restart
      replays `seq > cursor` in order; a replayed `event_id` dedups on the consumer fake;
      (4) ciphertext assertion — raw `description` column and every cached value contain
      `enc.v1.` and no known plaintext; event rows and message bodies contain neither
      plaintext nor ciphertext description; (5) cache — gen-bump invalidation after write,
      fail-open with a broken client, read path without `REDIS_URL` (direct DB);
      (6) health — live 200 with DB down, ready 503 on DB down or missing key custody,
      `/health` aliases readiness; (7) dropped-notification reconciliation — advance the log
      without notifying → the tick publishes the missed event and advances the cursor, in
      order, with `event_id` dedup on the consumer.
    - The harness needs a real Postgres for groups 1-3/7 (`pg-mem` does not implement NOTIFY
      faithfully): create/point at a throwaway DB via `FEEDBACK_TEST_DB_URL`; never a data
      directory; skip, not fail, when Docker is unavailable.
    - Compose block mirrors the tags/todo services exactly (image/build, no unnecessary host
      port beyond the sibling pattern, `/health/ready` healthcheck, fail-fast master key).
    - README records the P1 dev posture: `npm run dev` starts feedback-service on 3108; dev
      needs a local Postgres (compose `postgres`) + `FEEDBACK_DB_URL` and `FEEDBACK_MASTER_KEY`
      in `.env.development` or the service exits fail-closed at boot.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` then
      `npm run test:unit -w @life/feedback-service -- test/feedback.e2e-spec.ts test/feedback-events.e2e-spec.ts test/health.e2e-spec.ts`
      and `npm run typecheck -w @life/feedback-service` and
      `npm run build -w @life/feedback-service`.
    - Strict constraints: NO full suites, NO E2E; only these named files; max test
      executions: 2. `docker compose config` for the wiring check only (no `up`).
  - [DEFINITION OF DONE]
    - [ ] All seven groups are covered and pass (or the Docker-dependent groups skip
          cleanly); the ciphertext assertions pass.
    - [ ] `docker compose config` shows the `feedback-service` block with both URL
          injections, healthy `depends_on`, `REDIS_URL`, fail-fast master key, and the app's
          `FEEDBACK_API_URL`; both env injections (`FEEDBACK_DB_URL`, `RABBITMQ_URL`);
          the app gets no 3108/3008 leak (dev 3108 is the dev stack's; harness uses 3107/3207);
          Dockerfiles carry the new manifest; lockfile updated.
    - [ ] Dev wiring is live: root `dev` script contains `"PORT=3108 npm run dev -w
          apps/feedback-service"` next to the tags `3104` / todo `3105` entries;
          `.env.development.example` gains `FEEDBACK_API_URL=http://127.0.0.1:3108` plus the
          commented `FEEDBACK_DB_URL` / `FEEDBACK_MASTER_KEY` names; README documents the
          3108 dev port, the local Postgres, and the fail-closed boot without them.
    - [ ] No production source file edited to make a test pass; no file outside scope.
  - Dependencies: T9. Size: M.

- [ ] T11: `@life/ui` feedback blocks — module `feedback-ui`
  - [TASK OBJECTIVE] Add the reusable `FeedbackForm` + `FeedbackNavItem` blocks and make the
    `ListShell` fab optional, spec-first upstream, with tests.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/ui/src/components/feedback-form.tsx` (new),
      `packages/ui/src/components/feedback-nav-item.tsx` (new),
      `packages/ui/src/components/list-shell.tsx` (make `fabHref`/`fabLabel`/`fabIcon`
      optional; `FabLink` renders only when `fabHref` is given),
      `packages/ui/src/index.ts` (+ `FeedbackForm`, `FeedbackNavItem`, `FEEDBACK_TYPES`),
      `packages/ui/test/feedback-form.test.tsx` (new),
      `packages/ui/test/feedback-nav-item.test.tsx` (new),
      `packages/ui/test/list-shell.test.tsx` (+ omitted-fab assertion),
      `packages/ui/package.json` (types-only dependency `@life/shared`),
      `docs/specs/SPEC-ui-list-shell.md` (document the optional fab in the same change),
      `docs/specs/MAP-ui-primitives.md` (rows for the two new blocks — Contract 1 Rule 3),
      `packages/ui/src/styles/blocks.css` (only if one `ui-feedback-form` spacing hook is
      genuinely needed; token-only).
    - Reference files (read-only): `apps/app/app/notes/page.tsx` /
      `apps/app/app/todos-nav.tsx` (the `ListShell` call sites), `packages/ui/src/index.ts`,
      `apps/app/app/recurrence-dialog.tsx` (`PillGroup` + `Pill as="button"` +
      `aria-pressed` precedent; `Textarea aria-label` precedent), `docs/specs/SPEC-feedback-ui.md`,
      `packages/shared/src/index.ts` (the T6 types).
    - Strictly prohibited files: `apps/**` (T12/T13 consume), `packages/shared/**`,
      `packages/ui/test/tokens.test.ts` + `SPEC-ui-tokens.md` (frozen token values).
  - [IMPLEMENTATION REQUIREMENTS]
    - Primitive reuse plan (Contract 1, no raw HTML / no inline style / tokens only):
      `IconButton` for the toolbar trigger; `Dialog` (body/footer slots) for the container;
      `PillGroup` + `Pill as="button"` + `aria-pressed` for the three type choices;
      `Textarea` (aria-label/required/invalid passthrough) for the description; `AlertBanner`
      with `role="alert"` for errors; `Button` for submit/cancel. No new visual language.
      Any fit problem is fixed upstream here, never in the app.
    - `FeedbackFormProps` and `FeedbackNavItemProps` exactly as SPEC-feedback-ui
      `## Component contracts`; `FeedbackNavItem` owns the `open` state and composes
      `FeedbackForm`. `FEEDBACK_TYPES` exported from `feedback-form.tsx`
      (`feature_request`→"Feature request", `enhancement`→"Enhancement",
      `bug_report`→"Bug report"); default selected type = the first.
    - Idempotency key (intent 5): `crypto.randomUUID()` minted when the dialog opens, held in
      a ref, reused for every attempt of that open (retry/double-tap/Enter race), regenerated
      on a fresh open; submit disabled while pending; the id never leaves the request path.
    - Validation (exact): `description.trim().length === 0` → no request, error
      `'Description is required.'` in the `AlertBanner`, `aria-invalid` on the textarea,
      focus moves to it; the submit button is not disabled beforehand. Server-side failures
      surface the same banner and keep the dialog open with the same id.
    - Frozen-surface strings introduced here (record in `SPEC-ui-list-shell.md`):
      `aria-label="Send feedback"`, `aria-label="Feedback type"`, `aria-label="Description"`,
      `Feature request`/`Enhancement`/`Bug report`, `Send`/`Sending…`/`Cancel`, dialog title
      `Send feedback`, page title `Feedback`.
    - Tests: dialog open/close via props; three pills with `aria-pressed`; blank submit sends
      no request and shows the error with `aria-invalid`; valid submit calls `onSubmit` with
      `{ id, app, type, description }` (trimmed) and closes; rejected submit keeps it open and
      the retry carries the same `id`; reopening mints a new `id`; disabled while pending;
      exact `app` passed through; `FeedbackNavItem` carries the frozen `aria-label` and opens
      the dialog; `ListShell` without fab props renders no `FabLink` and its slot-order
      assertions are unchanged.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` (the shared-build precondition —
      `@life/ui` now type-depends on it) then
      `npm run test:unit -w @life/ui -- test/feedback-form.test.tsx test/feedback-nav-item.test.tsx test/list-shell.test.tsx`
      and `npm run typecheck -w @life/ui`.
    - Strict constraints: NO full suites, NO E2E; only these three named files; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Both blocks and the optional-fab `ListShell` match the spec contract; no raw HTML,
          inline style, or raw value; the `@life/shared` types-only edge is one line.
    - [ ] `SPEC-ui-list-shell.md` + `MAP-ui-primitives.md` updated in this change; frozen
          token values untouched.
    - [ ] The named suite + `npm run typecheck -w @life/ui` pass; no file outside scope.
  - Dependencies: T6. Size: M.

- [ ] T12: `/feedback` route + BFF + inbox — module `feedback-ui`
  - [TASK OBJECTIVE] Add the app-owned BFF transport, the submit server action, and the
    `/feedback` route that renders the owner inbox grouped app → type.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/lib/feedback-api.ts` (new),
      `apps/app/app/feedback-actions.ts` (new),
      `apps/app/app/feedback/layout.tsx` (new),
      `apps/app/app/feedback/page.tsx` (new),
      `apps/app/app/feedback-inbox.tsx` (new),
      `apps/app/test/feedback-inbox.test.tsx` (new).
    - Reference files (read-only): `apps/app/lib/api.ts` (`callService` + `ApiError`),
      `apps/app/app/actions.ts` / `todo-actions.ts` (server-action pattern),
      `apps/app/app/notes/layout.tsx` (`routeLayoutMetadata` + `RouteLayout`),
      `apps/app/app/note-list.tsx` / `todo-list.tsx` (app-glue precedent),
      `packages/ui/src/index.ts` (`ListShell`, `Section`, `List`, `ListItem`, `EmptyState`,
      `LocalTime`), `docs/specs/SPEC-feedback-ui.md` (`## Data fetch`, `## /feedback owner
      inbox`).
    - Strictly prohibited files: `packages/ui/**` (T11), `packages/shared/**`,
      toolbar files (`notes/page.tsx`, `todos-nav.tsx` — T13), PWA/gate files (T13),
      `apps/app/test/e2e/**` (T14).
  - [IMPLEMENTATION REQUIREMENTS]
    - `lib/feedback-api.ts` follows `lib/api.ts`: `import 'server-only'`;
      `const FEEDBACK_API_URL = process.env.FEEDBACK_API_URL ?? 'http://127.0.0.1:3008'`
      (dev runs on 3108 — dev stack overrides `FEEDBACK_API_URL` to
      `http://127.0.0.1:3108`, mirroring `TODO_API_URL`); one thin
      `call<T>()` over `callService`; `listFeedback(): Promise<FeedbackDto[]>` (`GET
      /api/feedback`) and `createFeedback(input: CreateFeedbackInput)` (`POST
      /api/feedback`). The browser never talks to the service directly; the BFF only forwards
      the caller's token. No type re-declaration (import from `@life/shared`).
    - `feedback-actions.ts` (`'use server'`): `submitFeedbackAction(input: CreateFeedbackInput):
      Promise<FeedbackSubmitResult>` → POST; catch `ApiError` →
      `{ ok: false, message: "Couldn't send feedback. Try again." }` (duplicates return
      `201`, never `409`); on ok `revalidatePath('/feedback')`.
    - `feedback/layout.tsx` mirrors `notes/layout.tsx`:
      `routeLayoutMetadata('/manifest-feedback.json', 'Feedback', '/icon-feedback.png')` +
      `export default RouteLayout`. (The manifest/icon files are T13's; the layout references
      them by URL only.)
    - `feedback/page.tsx`: server component, `dynamic = 'force-dynamic'`; calls
      `listFeedback()`; passes entries + `submitFeedbackAction` to `FeedbackInbox`.
    - `feedback-inbox.tsx` (app glue, never fetches): groups by `app` → `type` preserving
      encounter order (service already returns newest-first — stable bucketing, no re-sort);
      canonical app order `notes → todos → feedback`, unknown app ids last alphabetically;
      canonical type order `feature_request → enhancement → bug_report`, unknown last;
      labels via lookups `??` the raw id. Renders exactly:
      `ListShell(title="Feedback", navTrailing=<FeedbackNavItem app="feedback"
      onSubmit={submitFeedbackAction} />, fab omitted)` → `Section` (h2 app) → `Section`
      (h3 type) → `List` → `ListItem` (title = description, `meta = <LocalTime
      dateTime={createdAt} />`). One row type — plain `ListItem`, no variant, no leading
      control, no href, no sibling row component (lesson 0018). Zero entries → `EmptyState`
      (`heading="No feedback yet."`, `body="Use the feedback button in the toolbar to send
      the first one."` — body copy points at the toolbar item, SPEC-feedback-ui line 324);
      a group bucket that somehow arrives empty renders an
      inline `EmptyState`, never an empty `<List>`. Dates only through `LocalTime` (lesson
      0003); no today/overdue logic (lesson 0019 not applicable).
    - `FeedbackInbox` receives the action as a prop and forwards it to `FeedbackNavItem`
      (a client component) — the app never manages dialog state.
    - Test `feedback-inbox.test.tsx`: app→type nesting; newest-first order preserved inside
      groups; canonical group order; unknown app/type labels fall back to the raw id; zero
      entries → `EmptyState` asserting `heading="No feedback yet."` and the toolbar-pointing
      `body` copy (`"Use the feedback button in the toolbar to send the first one."`);
      never an empty `<List>`.
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` then
      `npm run test:unit -w @life/app -- test/feedback-inbox.test.tsx` and
      `npm run typecheck -w @life/app`.
    - Strict constraints: NO full suites, NO E2E; only this named file; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The route renders the grouped inbox from a bare `FeedbackDto[]`; the BFF + action
          match the spec signatures; no raw HTML / `next/link` / raw value in the new files.
    - [ ] The named suite + `npm run typecheck -w @life/app` pass; no file outside scope.
  - Dependencies: T11. Size: M.

- [ ] T13: toolbar item + PWA identity — module `feedback-ui`
  - [TASK OBJECTIVE] Put `FeedbackNavItem` in the Notes/Todos(+lenses)/Feedback toolbars and
    give `/feedback` its own PWA identity (new manifest, icon, gate allowlist) without
    touching frozen constants.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/app/notes/page.tsx` (navTrailing gains
      `<FeedbackNavItem app="notes" onSubmit={submitFeedbackAction} />` **before** the
      `Settings` `IconLink`), `apps/app/app/todos-nav.tsx` (same with `app="todos"`, before
      Settings — shared by `/todos` and its lenses, lesson 0014), `apps/app/app/feedback/page.tsx`
      (its `FeedbackInbox` already renders the item via T12; confirm `app="feedback"` and that
      Settings, if any, stays last), `apps/app/lib/auth/gate.ts` (`PUBLIC_EXACT +=`
      `/manifest-feedback.json`, `/icon-feedback.png`),
      `apps/app/public/manifest-feedback.json` (new — `id`/`start_url`/`scope` all
      `/feedback`, `name: "Personal Life — Feedback"`, `short_name: "Feedback"`,
      `display: standalone`, icon `/icon-feedback.png` 512×512 `purpose: any`, the same
      light-app palette values as the sibling manifests — copied as values inside the new
      file), `apps/app/public/icon-feedback.png` (new 512×512 PNG, committed like the
      sibling icons — `icon-notes.png`/`icon-todos.png` are checked-in binaries; the repo
      has no icon-generator script and no rasterizer dependency),
      `apps/app/test/manifests.test.ts` (+ `/feedback` case),
      `apps/app/test/gate.test.ts` (+ the two new public paths).
    - Reference files (read-only): `apps/app/app/notes/page.tsx` (current navTrailing order),
      `apps/app/public/manifest-notes.json` / `manifest-todos.json` (value shape),
      `apps/app/app/notes/layout.tsx`, `apps/app/lib/auth/gate.ts`, `docs/specs/SPEC-feedback-ui.md`
      (`## Toolbar integration`, `## PWA identity`), `docs/lessons/0005-*.md`, `docs/lessons/0014-*.md`.
    - Strictly prohibited files: `apps/app/public/manifest-notes.json`,
      `manifest-todos.json`, `icon.svg`, `apps/app/app/layout.tsx` `viewport.themeColor`
      (frozen — zero diff), the frozen e2e suites (`journey*.ts`), `packages/ui/**`.
  - [IMPLEMENTATION REQUIREMENTS]
    - The item is an `IconButton` (opens a dialog), never `IconLink` (no route); placed
      before `Settings` so Settings stays last (the recorded order).
    - `manifest-feedback.json` asserted by the test: `id`/`start_url`/`scope` all `/feedback`,
      `short_name` `Feedback`, and `feedback/layout.tsx` links `/manifest-feedback.json`.
    - `gate.test.ts`: the two new paths are public; everything else still gated.
    - Frozen PWA constants and the frozen e2e selector surface see zero diff (new files +
      new selectors only).
  - [VERIFICATION & TESTING RULES]
    - Permitted command: `npm run build -w @life/shared` then
      `npm run test:unit -w @life/app -- test/manifests.test.ts test/gate.test.ts
      test/routes-todos-list.test.tsx` and
      `npm run typecheck -w @life/app`.
    - Strict constraints: NO full suites, NO E2E; only these three named files; max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The three toolbars render the item with the correct `app` id, Settings last;
          `/feedback` has its own manifest + icon + gate entries.
    - [ ] `git diff` shows zero changes to the frozen manifests, `viewport.themeColor`,
          `icon.svg`, and the frozen e2e suites.
    - [ ] Named suites + `npm run typecheck -w @life/app` pass; no file outside scope.
    - [ ] `test/routes-todos-list.test.tsx` (the existing suite asserting the Todos nav
          aria-labels this task edits) stays green unchanged.
  - Dependencies: T12. Size: M.

- [ ] T14: e2e harness + the one targeted e2e run — module `feedback-ui`
  - [TASK OBJECTIVE] Bring feedback-service (with a throwaway Postgres) up in the Playwright
    harness and prove the submit → inbox flow with the chapter's single targeted e2e run.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/test/e2e/stack.ts`,
      `apps/app/test/e2e/config.ts`, `apps/app/test/e2e/global-setup.ts`,
      `apps/app/test/e2e/global-teardown.ts`, `apps/app/test/e2e/services.ts` (only if the
      shared spawn helper needs a small extension),
      `apps/app/test/e2e/feedback.spec.ts` (new).
    - Reference files (read-only): `apps/app/test/e2e/stack.ts` (existing service wiring),
      `apps/app/test/e2e/services.ts` (`spawnService`/`waitForHttp`), `packages/db/test/
      pg-integration.test.ts` (the throwaway-container pattern),
      `docs/specs/SPEC-feedback-ui.md` (`## Testing Strategy` — E2E), `apps/app/playwright.config.ts`.
    - Strictly prohibited files: frozen e2e suites/assertions (`journey*.ts`), all production
      source (a harness bug that needs a source fix re-opens its owning task), `compose.yaml`.
  - [IMPLEMENTATION REQUIREMENTS]
    - Harness: start a throwaway Postgres (`docker run --rm -d --name feedback-pg-e2e … 
      postgres:17-alpine`), wait for `pg_isready`; spawn `feedback-service` with
      `FEEDBACK_DB_URL` → the throwaway, a test `FEEDBACK_MASTER_KEY`, the harness's
      `FEEDBACK_IDP_JWKS_URL`/audience, `PORT` on the harness's own scheme — never
      3008/3108: add `feedbackPort` to `testPorts()` (`E2E_FEEDBACK_PORT ?? 3107`) and to
      `devPorts()` (`E2E_DEV_FEEDBACK_PORT ?? 3207`), mirroring the existing 31xx/32xx
      entries in `apps/app/test/e2e/config.ts`; **no `REDIS_URL`**
      (fail-open direct DB) and **no `RABBITMQ_URL`** (the spec's broker-down tolerance);
      the app gets `FEEDBACK_API_URL` → the spawned service (harness port, never 3008/3108).
      `global-teardown` force-removes the
      container and its scratch state. Docker absent → fail fast with a clear message (the
      e2e is the chapter's final proof; a silent skip would hide it).
    - `feedback.spec.ts`, one test (`-g "submit feedback"`): on `/notes`, `getByLabel('Send
      feedback')` opens the dialog; submit a blank description → assert `'Description is
      required.'` and (navigate `/feedback`) the `EmptyState` (no row created); pick a type,
      write a description, submit → `/feedback` shows the entry under the right app group and
      type group. Only its own new selectors — nothing shared with the frozen suites.
    - Exactly ONE targeted run (a second run only if the first fails, then read the trace,
      fix the cause, re-run once — profile `max-test-runs: 2`).
  - [VERIFICATION & TESTING RULES]
    - Permitted command:
      `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/feedback.spec.ts -g "submit feedback"`
      (`-g` per the spec; the config path as given by the profile).
    - Strict constraints: NO other e2e spec, NO full suite, NO unqualified runner; ONE
      targeted run (max 2); max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The harness launches Postgres + feedback-service; the single run passes: blank
          submit creates no row, a valid submit appears on `/feedback` under the right app
          and type group.
    - [ ] No frozen suite/assertion or production source file modified; no file outside scope.
  - Dependencies: T13, T10. Size: M.

- [ ] T15: five-lane verification gate — module `close`
  - [TASK OBJECTIVE] Run the §7.6 gate on the final integrated state and iterate until N/N
    PASS.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: none (verification only; fixes re-open their owning task).
    - Reference files (read-only): the working diff, `tasks/plan-feedback.md`,
      `tasks/todo-feedback.md`, the three `SPEC-feedback-*.md`, `docs/specs/MAP-feedback.md`,
      `AGENTS.md` (Contracts + mechanical checks).
    - Strictly prohibited files: everything (this task changes nothing).
  - [IMPLEMENTATION REQUIREMENTS]
    - Suite gate first, exact commands:
      `npm run build -w @life/shared`;
      `npm run typecheck -w packages/db` and
      `npm run test:unit -w packages/db -- test/backup-pg.test.ts test/restore-pg.test.ts`;
      `npm run typecheck -w @life/feedback-service` and
      `npm run test:unit -w @life/feedback-service -- test/feedback.e2e-spec.ts test/feedback-events.e2e-spec.ts test/health.e2e-spec.ts`;
      `npm run typecheck -w @life/ui` and
      `npm run test:unit -w @life/ui -- test/feedback-form.test.tsx test/feedback-nav-item.test.tsx test/list-shell.test.tsx`;
      `npm run typecheck -w @life/app` and
      `npm run test:unit -w @life/app -- test/feedback-inbox.test.tsx test/manifests.test.ts test/gate.test.ts test/routes-todos-list.test.tsx` (the last is an existing suite T13's toolbar edits touch — Success 6 requires it unchanged and passing);
      plus the six Contract mechanical greps from the plan's checkpoint.
    - Then five parallel lane subagents (read-only; QA runs the suite gate), each returning
      `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`:
      correctness/domain, code quality, security, QA, plan conformance. Fail-closed; any
      failed lane → fix its blockers → re-run ONLY the failed lanes → repeat until N/N.
      Commit only on N/N, staged by explicit paths (never `git add -A`): the shared/ui files,
      feedback-service source + tests, app source + tests, infra (`compose.yaml`, both
      Dockerfiles + the updated existing Dockerfiles, `package-lock.json`, `.env.example`),
      `packages/db` files, and the plan/ledger/spec docs. Conventional Commit, e.g.
      `feat(feedback): owner feedback capture + durable feedback.submitted event stream`.
    - The e2e is NOT re-run inside the gate (T14 ran it once); the gate's suite commands stay
      within §3 and the profile.
  - [VERIFICATION & TESTING RULES]
    - Permitted: the suite-gate commands (QA lane only). NO full suites, NO E2E; max test
      executions: 2 per iteration. Evidence = per-round lane reports.
  - [DEFINITION OF DONE]
    - [ ] All suite-gate commands green; the six mechanical greps clean.
    - [ ] Five lane verdicts all PASS (N/N); no partial verdict treated as done.
    - [ ] No commit outside the explicit paths; merge remains human-gated.
  - Dependencies: T14. Size: M.

- [ ] T16: `@life/shared` — feedback title wire fields — module `feedback-service`
  - [TASK OBJECTIVE] Add the amendment-10 wire contract: `FEEDBACK_TITLE_MAX` (= 200) and a
    required `title: string` on `FeedbackDto` and `CreateFeedbackInput`.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/shared/src/index.ts`,
      `packages/shared/test/index.test.ts`.
    - Reference files (read-only): `docs/specs/MAP-feedback.md` (locked interfaces),
      `docs/specs/SPEC-feedback-service.md` (`## API / DTO contract`),
      `docs/intent/feedback-service.md` (locked decision 10).
    - Strictly prohibited files: every other file (no service, no UI, no app code).
  - [IMPLEMENTATION REQUIREMENTS]
    - `packages/shared/src/index.ts`: `export const FEEDBACK_TITLE_MAX = 200;` beside
      `FEEDBACK_DESCRIPTION_MAX`; `FeedbackDto` gains `title: string;` before `description`;
      `CreateFeedbackInput` gains `title: string;` before `description`. Every existing export
      (`FEEDBACK_DESCRIPTION_MAX`, `FEEDBACK_APPS`, `FeedbackType`, …) stays byte-identical. No
      new file, no runtime logic, no `feedback/dto/` split (the module is flat today).
    - Code style: prose — intention-revealing names, the surrounding feedback block's existing
      comment density (it is comment-free; add none).
    - Test: extend `packages/shared/test/index.test.ts` with one case asserting
      `FEEDBACK_TITLE_MAX === 200` and `FEEDBACK_TITLE_MAX < FEEDBACK_DESCRIPTION_MAX` (the two
      bounds the service DTO mirrors).
  - [VERIFICATION & TESTING RULES]
    - Permitted commands: `npm run typecheck -w @life/shared` and
      `npm run test:unit -w @life/shared -- test/index.test.ts`.
    - Strict constraints: NO other workspace, NO full suite, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] `FeedbackDto`/`CreateFeedbackInput` carry `title`; `FEEDBACK_TITLE_MAX` = 200 exported.
    - [ ] No existing export changed; no file outside scope modified.
    - [ ] Typecheck + the named test pass.
  - Dependencies: —. Size: S.

- [ ] T17: feedback-service — `title` column + DTO + encrypt/decrypt + suites — module `feedback-service`
  - [TASK OBJECTIVE] Persist, read back, and encrypt/decrypt a required `title` beside the
    description, keeping the event payload metadata-only (amendment 10).
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create:
      `apps/feedback-service/src/feedback/feedback.entity.ts`,
      `apps/feedback-service/src/feedback/dto/create-feedback.dto.ts`,
      `apps/feedback-service/src/feedback/feedback.service.ts`,
      `apps/feedback-service/test/feedback.e2e-spec.ts`,
      `apps/feedback-service/test/feedback-harness.ts` (only if its POST-body builder needs `title`),
      `apps/feedback-service/test/feedback-events.e2e-spec.ts` (**probe-INSERT line only** — the
      raw-SQL seed gains `title` for NOT NULL parity; the events suite itself is not run here).
    - Reference files (read-only): `docs/specs/SPEC-feedback-service.md` (data model, API/DTO,
      cache, test group 4, traceability), `apps/feedback-service/src/event/**` (the **unchanged**
      event contract — read only to confirm no title leaks in),
      `apps/todo-service/src/todos/todo.entity.ts` + `apps/todo-service/src/todos/todos.service.ts`
      (the `titleAad` + `encryptField`/`isCiphertextRow` precedent),
      `apps/feedback-service/src/feedback/feedback-cache.ts`.
    - Strictly prohibited files: `apps/feedback-service/src/event/**` (the event body stays
      `{ event_id, feedback_id, owner_sub, app, type, occurred_at }` — putting a title in it is
      **not** authorized), `feedback-event.entity.ts`, `trigger-ddl.ts`, `apps/app/**`,
      `packages/**`.
  - [IMPLEMENTATION REQUIREMENTS]
    - Entity: `@Column({ type: 'text' }) title: string;` after `type`, before `description`; the
      doc comment records that both `title` and `description` are `enc.v1.` envelopes with the
      AAD `life.v1|<sub>|feedback|title|<id>`.
    - Service: add `titleAad(ownerSub, feedbackId)` returning
      `` `life.v1|${ownerSub}|feedback|title|${feedbackId}` `` mirroring `descriptionAad`;
      `create` encrypts both fields; the cached row shape + `toCachedRow` carry `title`;
      `isCiphertextRow` requires **both** `title` and `description` to start with `ENC_PREFIX`;
      `toDto` decrypts both after the hit. The duplicate-`id` no-op path is unchanged.
    - DTO: add `@IsNotEmpty()` + `@MaxLength(FEEDBACK_TITLE_MAX)` `title: string;` above
      `description`, importing `FEEDBACK_TITLE_MAX` from `@life/shared` (the `description`
      validator keeps `FEEDBACK_DESCRIPTION_MAX`).
    - Event: **no change** — publisher, `feedback_event` entity, trigger DDL, dispatcher stay
      title-free; the suite asserts that absence for `title` too.
    - Suites: every POST body in `feedback.e2e-spec.ts` gains a `title`; the ciphertext
      assertion covers the raw `title` column and cached values (no known plaintext); a
      missing/blank/over-long title → `400`; the idempotency + event groups keep passing.
    - Code style: prose — small single-purpose functions, intention-revealing names, the file's
      existing doc-comment density on the AAD helper and the cached shape.
  - [VERIFICATION & TESTING RULES]
    - Precondition: `npm run build -w @life/shared` (T16 changed the shared types; consumers
      resolve through `node_modules` → `packages/shared/dist` — ledger precondition above).
    - Permitted commands: `npm run typecheck -w @life/feedback-service` and
      `npm run test:unit -w @life/feedback-service -- test/feedback.e2e-spec.ts`.
    - Strict constraints: NO full suite, NO E2E, and no `feedback-events.e2e-spec.ts` run (the
      event path must not change; that file's only edit is the probe-INSERT line gaining
      `title`, so the raw-SQL seed stays consistent with the NOT NULL column); max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Raw `title` + every cached row are `enc.v1.`; a blank/over-long title → `400`; a valid
          POST round-trips both title and description through `GET`.
    - [ ] No `feedback_event` row or message body carries a plaintext **or** ciphertext title
          (asserted; the `src/event/**` files show no diff).
    - [ ] No file outside scope modified; typecheck + the named suite pass.
  - Dependencies: T16. Size: M.

- [ ] T18: `@life/ui` — `FeedbackForm` title field + ordered validation — module `feedback-ui`
  - [TASK OBJECTIVE] Add a required title `Input` above the description with ordered client
    validation, and update the form suite.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `packages/ui/src/components/feedback-form.tsx`,
      `packages/ui/test/feedback-form.test.tsx`, `packages/ui/test/feedback-nav-item.test.tsx`
      (its submit fixture gains `title`).
    - Reference files (read-only): `docs/specs/SPEC-feedback-ui.md` (component contract,
      rendered structure, validation, frozen strings), `packages/ui/src/components/input.tsx`,
      `packages/ui/src/styles/blocks.css`.
    - Strictly prohibited files: every other `packages/ui` file and all of `apps/**` (the inbox
      row mapping is T19).
  - [IMPLEMENTATION REQUIREMENTS]
    - State: `title`, `description`, `error` (message), `errorField: 'title' | 'description' |
      null`. On submit: trim both; blank title → `error = 'Title is required.'`,
      `errorField = 'title'`; else blank description → `'Description is required.'`,
      `errorField = 'description'`; on either, **no request** is sent and focus moves to the
      offending control. Valid → `onSubmit({ id, app, type, title: title.trim(), description:
      description.trim() })`.
    - Markup: `<Input aria-label="Title" aria-required maxLength={FEEDBACK_TITLE_MAX}
      aria-invalid={errorField === 'title' || undefined} …/>` immediately above the existing
      `Textarea`; the `Textarea`'s `aria-invalid` becomes `errorField === 'description'`.
      `title`/`description`/`error`/`errorField` reset on each fresh open (idempotency + reset
      semantics unchanged). Import `FEEDBACK_TITLE_MAX` from `@life/shared`.
    - Fit: no new CSS expected (the `Dialog` body flex gap owns spacing); if a hook is genuinely
      needed, at most one token-only `ui-feedback-form` rule in `blocks.css` — never inline
      `style`, never a raw value.
    - Suites: `feedback-form.test.tsx` gains the two ordered cases (blank title; title present +
      blank description), each asserting no `onSubmit` call, the exact message, `aria-invalid` on
      the offending field, and focus there; the happy path asserts
      `{ id, app, type, title, description }` trimmed; the retry-keeps-`id` and
      reopen-mints-new-`id` cases keep passing with a title filled in.
    - Code style: prose — the block's existing structure (small helpers, intention-revealing
      names) and comment density.
  - [VERIFICATION & TESTING RULES]
    - Precondition: `npm run build -w @life/shared`.
    - Permitted commands: `npm run typecheck -w @life/ui` and
      `npm run test:unit -w @life/ui -- test/feedback-form.test.tsx test/feedback-nav-item.test.tsx`.
    - Strict constraints: NO other suite, NO full suite, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Blank title and (with a title) blank description each block the request with their
          exact message, `aria-invalid`, and focus on the offending field; a valid submit
          carries both trimmed.
    - [ ] `aria-label="Title"` present; idempotency semantics unchanged.
    - [ ] No file outside scope modified; typecheck + the named suites pass.
  - Dependencies: T16. Size: S.

- [ ] T19: `apps/app` — inbox row title + description — module `feedback-ui`
  - [TASK OBJECTIVE] Render each inbox entry as a title line with the description beneath it
    (`ListItem` `title` + `snippet`), and update the inbox suite.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/app/feedback-inbox.tsx`,
      `apps/app/test/feedback-inbox.test.tsx`.
    - Reference files (read-only): `docs/specs/SPEC-feedback-ui.md` (`/feedback owner inbox` —
      rendering), `packages/ui/src/components/list-item.tsx` (`snippet`), `apps/app/lib/feedback-api.ts`.
    - Strictly prohibited files: `apps/app/lib/**`, `apps/app/app/feedback/**` (route + page),
      `packages/**`, every other app suite.
  - [IMPLEMENTATION REQUIREMENTS]
    - `feedback-inbox.tsx`: each entry's `ListItem` becomes
      `<ListItem title={entry.title} snippet={entry.description}
      meta={<LocalTime dateTime={entry.createdAt} />} />`. Grouping, encounter order, app/type
      labels, unknown-id fallback, `EmptyState`, and the one-row-type rule are unchanged — no
      `variant`, no `leading`, no href.
    - Suite: `feedback-inbox.test.tsx` fixtures gain a `title` distinct from the description;
      assert the row title renders the entry title and the description renders in the row's
      secondary line; the grouping/order/empty/fallback cases stay green.
    - Code style: prose; the file's existing comment density.
  - [VERIFICATION & TESTING RULES]
    - Precondition: `npm run build -w @life/shared`.
    - Permitted commands: `npm run typecheck -w @life/app` and
      `npm run test:unit -w @life/app -- test/feedback-inbox.test.tsx`.
    - Strict constraints: NO other app suite, NO full suite, NO E2E; max test executions: 2.
  - [DEFINITION OF DONE]
    - [ ] Row title = entry title, description = the row's `snippet`; grouping/order/empty
          states and unknown-id fallback unchanged.
    - [ ] No file outside scope modified; typecheck + the named suite pass.
  - Dependencies: T16. Size: S.

- [ ] T20: e2e — title step + the one targeted run — module `feedback-ui`
  - [TASK OBJECTIVE] Extend the single targeted e2e with the required title and run it once.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: `apps/app/test/e2e/feedback.spec.ts`.
    - Reference files (read-only): `docs/specs/SPEC-feedback-ui.md` (`## Testing Strategy` — E2E),
      the harness files (`stack.ts`, `config.ts`, `global-setup.ts`, `global-teardown.ts`,
      `services.ts`) that T14 already wired and this task does **not** touch.
    - Strictly prohibited files: the harness files, the frozen suites (`journey*.ts`), all
      production source.
  - [IMPLEMENTATION REQUIREMENTS]
    - The one test (`-g "submit feedback"`): blank **title** submit → assert
      `'Title is required.'` and, after navigating to `/feedback`, the `EmptyState` (no row);
      then pick a type, fill `getByLabel('Title')` + `getByLabel('Description')`, submit →
      `/feedback` shows the entry under the right app and type group with **both** lines visible.
      Only the spec's own selectors (`getByLabel('Send feedback')`, the pills, the title input,
      the description textarea, the heading `Feedback`).
    - Exactly ONE targeted run (a second only if the first fails: read the trace, fix the cause,
      re-run once — profile `max-test-runs: 2`).
  - [VERIFICATION & TESTING RULES]
    - Permitted command:
      `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/feedback.spec.ts -g "submit feedback"`
      (the harness binds its own throwaway ports 3107/3207 — never 3008/3108).
    - Strict constraints: NO other e2e spec, NO full suite, ONE targeted run (≤2); max test
      executions: 2.
  - [DEFINITION OF DONE]
    - [ ] The single run passes: a blank title creates no row; a valid submit shows the title
          **and** the description on `/feedback` under the right groups.
    - [ ] No frozen suite/assertion or production source modified; no file outside scope.
  - Dependencies: T19. Size: S.

- [ ] T21: five-lane verification gate — module `close`
  - [TASK OBJECTIVE] Run the §7.6 gate on the final integrated state and iterate until N/N PASS.
  - [SCOPE & REPOSITORY CONTEXT]
    - Allowed files to edit/create: none (verification only; fixes re-open their owning task).
    - Reference files (read-only): the working diff, `tasks/plan-feedback.md`,
      `tasks/todo-feedback.md`, `docs/specs/SPEC-feedback-*.md`, `docs/specs/MAP-feedback.md`,
      `docs/intent/feedback-service.md`, `AGENTS.md` (Contracts + mechanical checks).
    - Strictly prohibited files: everything (this task changes nothing).
  - [IMPLEMENTATION REQUIREMENTS]
    - Suite gate first, exact commands:
      `npm run build -w @life/shared`;
      `npm run typecheck -w @life/shared` and
      `npm run test:unit -w @life/shared -- test/index.test.ts`;
      `npm run typecheck -w @life/feedback-service` and
      `npm run test:unit -w @life/feedback-service -- test/feedback.e2e-spec.ts test/feedback-events.e2e-spec.ts`;
      `npm run typecheck -w @life/ui` and
      `npm run test:unit -w @life/ui -- test/feedback-form.test.tsx test/feedback-nav-item.test.tsx`;
      `npm run typecheck -w @life/app` and
      `npm run test:unit -w @life/app -- test/feedback-inbox.test.tsx test/routes-todos-list.test.tsx`
      (the last is the existing suite the toolbar composition touches — Success 6 requires it
      unchanged and passing);
      plus the six Contract mechanical greps from the plan's Phase 4 checkpoint.
    - Then five parallel read-only lane subagents (correctness/domain, code quality, security,
      QA, plan conformance), each returning
      `{lane, verdict: PASS|PASS_WITH_NITS|FAIL, blockers: [{file, issue, severity}]}`; fail-closed;
      fix blockers → re-run ONLY the failed lanes → repeat until N/N. Commit only on N/N, staged
      by explicit paths (never `git add -A`).
    - The e2e is NOT re-run inside the gate (T20 ran it once); the gate's suite commands stay
      within §3 and the profile.
  - [VERIFICATION & TESTING RULES]
    - Permitted: the suite-gate commands (QA lane only). NO full suites, NO E2E; max test
      executions: 2 per iteration. Evidence = per-round lane reports.
  - [DEFINITION OF DONE]
    - [ ] All suite-gate commands green; the six mechanical greps clean.
    - [ ] Five lane verdicts all PASS (N/N); no partial verdict treated as done.
    - [ ] No commit outside the explicit paths; merge remains human-gated.
  - Dependencies: T20. Size: M.

## Checkpoints (planning-skill gates, global protocol §8 self-reviewed and logged)

- After T1 (Governing docs): the two greps non-empty; architecture.md records the deliberate
  revision.
- After T5 (Infra up): `docker compose config` clean; `docker compose up -d postgres rabbitmq
  redis-feedback` healthchecks green (tech lead, once); `packages/db` typecheck + unit suites
  green; integration green-or-skipped.
- After T10 (Service API + event proven): the spec's seven groups green; duplicate `id` →
  same `201 { id }`, no second event; notify → publish → cursor advance proven; `enc.v1.`-only
  cache/DB values; compose injection + healthy `depends_on` shown by `docker compose config`.
- After T13 (UI): unit suites green; Contract mechanical checks (six greps) clean; zero diff
  to frozen PWA constants/selectors.
- After T14: the one targeted e2e passes.
- After T15: five-lane gate N/N → report; merge awaits the user's explicit request.
- After T20 (title amendment): the one targeted e2e passes with the title step.
- After T21: five-lane gate N/N → report; merge awaits the user's explicit request.

## Gate log

- 2026-10-03: plan + ledger authored from the confirmed intent and the three module specs;
  pending the §6 plan-validation gate before the first task is delegated.
- 2026-10-15: **title amendment (intent decision 10).** User confirmed a *required* title
  alongside the description; spec-first artifacts landed before planning — intent (outcome +
  decision 10), `MAP-feedback.md` (POST body, `FeedbackDto`, `CreateFeedbackInput`,
  `FEEDBACK_TITLE_MAX`), `SPEC-feedback-service.md` (data-model column + per-field AAD, API/DTO,
  cache row, test group 4, traceability, amendment note), `SPEC-feedback-ui.md` (form field +
  ordered validation + frozen strings, inbox row mapping, tests, amendment note). Phase 6 +
  T16–T21 appended; pending the §6 gate on the amended plan before T16 is delegated.
- 2026-10-15: **lane-5 (plan-conformance) FAIL → repair.** Three ledger defects caught: (1) the
  `feedback-events.e2e-spec.ts` probe-INSERT edit (commit 55db29a) was out of scope — T17's
  allowed list now authorizes that file for the probe-INSERT line only, its suite run staying
  outside T17's prescribed test command; (2) the title-amendment checkpoint box 5 claimed a
  pre-amendment row still reads back, contradicting the risk row — corrected to the fail-closed
  truth (pre-amendment rows fail closed; dev-only remedy is dropped-and-resynced; no production
  backfill); (3) lock A8 still pinned the description-only `POST` body — updated to include
  `title` and annotated as superseded by the Phase 6 title amendment (intent decision 10). Fix-only
  round; failed lanes re-run pending.
- 2026-10-15: **title amendment five-lane gate: N/N PASS** on revision `418b0a3`. Fix round
  `4d71332` (clear `errorField` on a valid submit; name both content fields in the
  event/cache/entity comments; reduce the duplicate AAD docblock) + `65a1a7c` (the three lane-5
  ledger repairs) + `418b0a3` (the `aria-invalid`-clearing test). Re-run lanes: correctness PASS,
  code-quality PASS, security PASS, plan-conformance PASS, QA PASS (suite gate: 3 shared + 15 ui +
  17 app + 15 feedback-service tests, four typechecks, all green; one infra flake from stale
  `feedback-test-*` containers, cleaned then re-run once per the profile, green). QA passed in the
  first round and did not need a re-run — it was included by mistake; its result stands as
  confirmatory evidence. No blockers. Merge awaits the user's explicit request.
- 2026-10-15: **form UX polish (user feedback; lesson 0029).** Both feedback fields now render
  a visible label above the control plus a placeholder, and both required fields carry a
  visible `*` marker with one `* Required field` legend (`feedback-form.tsx`; `blocks.css`
  rules `.ui-field`, `.ui-field-label__required`, `.ui-field-legend`, existing tokens only).
  Ids come from `useId()` and are bound with `htmlFor`; `aria-label="Title"` /
  `aria-label="Description"` removed. The resolved accessible names stay `Title` /
  `Description`, so the frozen selector surface — including the e2e `getByLabel` queries —
  does not move. No new atom; no token change. Button geometry was raised in the same user
  message and then **reverted by the user** ("preserve the current width and height"): the
  dialog footer keeps its current size, `SPEC-ui-blocks.md` is untouched. Classified
  non-feature (visual polish, no behavior change), so the lesson-0015 path applies: direct
  §5 delegation with no §6 plan gate and no five-lane gate. Verification: `@life/ui`
  typecheck clean; `test/feedback-form.test.tsx` + `test/feedback-nav-item.test.tsx` 16/16
  pass. The nav-item suite's two `getByLabelText` queries were migrated to accessible-name
  queries — testing-library matches raw `textContent` (now `"Title *"`), while the accessible
  name correctly stays `Title`. No E2E run: no spec was created/removed/modified and the
  accessible names (the frozen surface) are unchanged, verified at the DOM level by an
  accessible-name assertion in the form suite. Spec: `SPEC-feedback-ui.md` amendment;
  lesson 0029 committed with this change. Merge awaits the user's explicit request.
