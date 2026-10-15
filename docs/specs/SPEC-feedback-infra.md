# Spec: feedback-infra — Postgres + RabbitMQ compose services and PostgreSQL-only backup/restore

Module id: `feedback-infra` (see `docs/specs/MAP-feedback.md`).
Traces to: `docs/intent/feedback-service.md` (CONFIRMED — decisions 2, 3, 4, 9 are locked).
Reference implementations this mirrors: `docs/specs/SPEC-db-backup-restore.md` (the SQLite
contract), `docs/specs/SPEC-service-kernel.md` (health dialect), `docs/specs/MAP-redis.md`
and `docs/lessons/0011-cache-contract-and-stale-maps.md` (per-service isolation).

## Objective

Give `feedback-service` (and every later Postgres service) the infrastructure it stands on:

- two dedicated `compose.yaml` services — `postgres-feedback` (the feedback store, with
  `pg_notify`/`LISTEN` for the change-log dispatcher) and `rabbitmq-feedback` (the AMQP 0-9-1
  broker) — each with its own named volume, each publishing its port on host
  loopback only (`postgres-feedback` → `127.0.0.1:5432:5432`, `rabbitmq-feedback` →
  `127.0.0.1:5672:5672`, so the host-run dev service on 3108 can reach them — the
  same host-loopback posture as `app`/`idp`), and a
  healthcheck the app layer can `depends_on` (the Redis instances stay internal-only);
- a PostgreSQL-only backup/restore pair in `@life/db` (`db:backup:pg` / `db:restore:pg`)
  that mirrors the SQLite contract exactly where it applies, using `pg_dump -Fc` and
  `pg_restore --list` in place of `VACUUM INTO` + `PRAGMA quick_check`.

This module owns no cache: `redis-feedback` is the service's own instance (per-service
isolation) and is specified by the `feedback-service` module. See `## Cache Rules`.

## Locked-decision traceability

| Intent decision / map interface | Encoded in |
|---|---|
| Intent 2 — feedback-service is the first Postgres-backed service | `compose.yaml` `postgres-feedback` service, `FEEDBACK_DB_URL` |
| Intent 3 — `pg_notify` on commit + persistent `LISTEN` | `postgres-feedback` uses a stock Postgres image (NOTIFY/LISTEN need no extra config) |
| Intent 4 — RabbitMQ, open AMQP 0-9-1, self-hosted, no vendor lock | `compose.yaml` `rabbitmq-feedback` service, `RABBITMQ_URL` |
| Intent 9 — Postgres-only backup/restore mirroring the SQLite contract | `## PostgreSQL-only backup/restore tooling` (commands, naming, manifest, retention, flags, probe, exit codes) |
| MAP infra — Postgres own service + volume; service reads `FEEDBACK_DB_URL` | `compose.yaml` `postgres-feedback`, `FEEDBACK_DB_URL` default |
| MAP infra — tests read `FEEDBACK_TEST_DB_URL` | `## Testing Strategy` (integration harness) |
| MAP infra — RabbitMQ own service; producer reads `RABBITMQ_URL` | `compose.yaml` `rabbitmq-feedback`, `RABBITMQ_URL` |
| MAP infra — `redis-feedback` own instance, `REDIS_URL` as elsewhere | Out of scope here; owned by `feedback-service`, referenced only in `depends_on` |
| Intent 8 / lesson 0012 — governing docs revised as a cross-chapter decision | This spec is the record `docs/intent/architecture.md` (no brokers/SQLite) is revised against |

## Scope

- **In scope:** the `postgres-feedback` and `rabbitmq-feedback` compose services, their named volumes, their
  env vars and healthchecks; the two password/URL entries in `.env.example`; the
  PostgreSQL backup/restore commands, flags, files, and tests in `packages/db`.
- **Out of scope:** `feedback-service` itself (tables, NOTIFY trigger, LISTEN dispatcher,
  RabbitMQ publisher, cache); `redis-feedback` (the service's own cache instance,
  specified by `feedback-service`); SQLite→Postgres reconciliation; any second broker;
  the crontab install; production deploy and any production data migration (hard-line,
  human-run — see `## Hard lines`).
- **Not changed:** the four existing SQLite services, their data files, the UI, tokens,
  PWA constants, the e2e selector surface.

## Tech Stack

- Compose services from stock images: `postgres:17-alpine` and `rabbitmq:4.1-alpine`
  (both support the required features with no custom build; `postgres-feedback` supports
  `pg_notify`/`LISTEN`, `rabbitmq-feedback` speaks AMQP 0-9-1).
- The PG backup/restore reuses `packages/db`'s existing `ts-node` CLI convention
  (`db:backup`, `db:restore`) and the shared `pruneRoutineSnapshots` retention function —
  no new workspace, no new third-party dependency.
- All Postgres client work (`pg_dump`, `pg_restore`, `psql`) runs **inside a container**
  via Docker; the host has no `psql`/`pg_dump` (`docs/intent/feedback-service.md:69`).

## compose.yaml additions

Named services, networks, and volumes only; no existing service moves. Both new services
join the existing `life` network and publish their main port on **host loopback only**
(`postgres-feedback` → `127.0.0.1:5432:5432`, `rabbitmq-feedback` → `127.0.0.1:5672:5672`) so the host-run
dev feedback-service (port 3108) can reach them — the same host-loopback posture as `app`
and `idp`. Production addresses stay on the internal compose network (`postgres-feedback:5432`,
`rabbitmq-feedback:5672`). The five (now six) Redis instances stay internal-only, as today
(`compose.yaml:227-356`).

```yaml
  postgres-feedback:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: feedback
      POSTGRES_USER: feedback
      # Fail-fast, like NOTE_MASTER_KEY: compose refuses to start with no password.
      POSTGRES_PASSWORD: ${FEEDBACK_DB_PASSWORD:?FEEDBACK_DB_PASSWORD is required}
    volumes:
      - postgres-feedback-data:/var/lib/postgresql/data
    networks:
      - life
    ports:
      # Host loopback only: the host-run dev service (3108) reaches Postgres here.
      # Production uses the internal compose network (`postgres-feedback:5432`).
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U feedback -d feedback"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  rabbitmq-feedback:
    image: rabbitmq:4.1-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${FEEDBACK_RABBITMQ_USER:-feedback}
      # Fail-fast, like POSTGRES_PASSWORD.
      RABBITMQ_DEFAULT_PASS: ${FEEDBACK_RABBITMQ_PASSWORD:?FEEDBACK_RABBITMQ_PASSWORD is required}
    volumes:
      - rabbitmq-feedback-data:/var/lib/rabbitmq
    networks:
      - life
    ports:
      # Host loopback only: the host-run dev service (3108) reaches the broker here.
      # Production uses the internal compose network (`rabbitmq-feedback:5672`).
      - "127.0.0.1:5672:5672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    restart: unless-stopped
```

Add `postgres-feedback-data:` and `rabbitmq-feedback-data:` to the bottom `volumes:` block
(`compose.yaml:362`), alongside `redis-app-data:`.

- **`ports:` is host-loopback only on the main ports.** `postgres-feedback` publishes
  `127.0.0.1:5432:5432` and `rabbitmq-feedback` publishes `127.0.0.1:5672:5672` — reachable
  from the host-run dev service (3108) only; production traffic uses the internal
  compose network names (`postgres-feedback:5432`, `rabbitmq-feedback:5672`). `redis-feedback` stays
  internal-only with no `ports:` at all.
- **RabbitMQ management UI is not exposed.** The image is the plain `rabbitmq:4.1-alpine`
  (not a `-management` tag) and `15672` is not published: a single producer with no
  operator UI requirement does not justify the extra port and authentication surface.
  Turning it on later is a deliberate, asked-first change (`## Boundaries`).
- **Each instance is dedicated**, not shared and not a namespaced tenant of another
  service's broker — the same rule `docs/intent/redis-shared-state.md` decision 3 and
  lesson 0011 establish for Redis.

`feedback-service` declares its dependency on healthy infrastructure (its full service
definition is the `feedback-service` module's):

```yaml
  feedback-service:
    depends_on:
      postgres-feedback:
        condition: service_healthy
      rabbitmq-feedback:
        condition: service_healthy
      redis-feedback:
        condition: service_healthy
```

Compose injects the two connection vars into that service (the `REDIS_URL` pattern —
`.env` unchanged, `compose.yaml:22` / `:64`):

```yaml
      FEEDBACK_DB_URL: postgresql://feedback:${FEEDBACK_DB_PASSWORD}@postgres-feedback:5432/feedback
      RABBITMQ_URL: amqp://feedback:${FEEDBACK_RABBITMQ_PASSWORD}@rabbitmq-feedback:5672
```

`.env.example` gains two documented **names** (values never committed), matching the
`NOTE_MASTER_KEY` comment style (`openssl rand -hex 32`):

```
# --- feedback service (feedback-service chapter) -----------------------------
# Postgres (feedback-infra). Compose fails fast without it.
FEEDBACK_DB_PASSWORD=
# RabbitMQ (feedback-infra). Compose fails fast without it.
FEEDBACK_RABBITMQ_PASSWORD=
```

`.env.development.example` gains the dev-side names (values never committed): `FEEDBACK_DB_URL`
(pointing at host loopback `127.0.0.1:5432`), `RABBITMQ_URL` (host loopback
`127.0.0.1:5672`), and `FEEDBACK_MASTER_KEY` — dev runs against the real compose
`postgres-feedback` + `rabbitmq-feedback` (`docker compose up -d postgres-feedback rabbitmq-feedback`, then `npm run dev`).
The e2e harness still starts its own throwaway Postgres; the `feedback-service` module
owns the fallback story when the broker is down.

## PostgreSQL-only backup/restore tooling

One version, PostgreSQL only (`docs/intent/feedback-service.md:64-70`). It mirrors the
SQLite contract (`docs/specs/SPEC-db-backup-restore.md`) wherever the contract is about
operator behavior, and differs only where SQLite is file-based and Postgres is
client-based.

### Commands

All commands run from the repository root. One version, PostgreSQL only:

```bash
npm run db:backup:pg -w @life/db                                   # routine (the cron form)
npm run db:backup:pg -w @life/db -- --pin                          # deliberate + pinned
npm run db:backup:pg -w @life/db -- --only feedback                # subset
npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z
npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z-pinned --only feedback
```

Root `package.json` (`scripts`, after `db:restore` at line 26):

```json
"db:backup:pg": "npm run db:backup:pg -w @life/db --",
"db:restore:pg": "npm run db:restore:pg -w @life/db --"
```

`packages/db/package.json` (`scripts`):

```json
"db:backup:pg": "ts-node scripts/backup-pg.ts",
"db:restore:pg": "ts-node scripts/restore-pg.ts"
```

The cron line — **documented for the human to install; installing machine-level config is
a hard line and is not done by the agent.** Adjust the checkout path if the host copy
differs from `/home/night/WebstormProjects/personal-life`:

```cron
0 4 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup:pg -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
```

### Connection env and `--only` mapping

- **`FEEDBACK_DB_URL`** carries the connection: a `postgresql://` URL
  (`postgresql://feedback:${FEEDBACK_DB_PASSWORD}@postgres-feedback:5432/feedback` in production).
  When unset the tooling defaults to `postgresql://feedback@postgres-feedback:5432/feedback`.
- **`FEEDBACK_TEST_DB_URL`** is the map's service/harness test var
  (`docs/specs/MAP-feedback.md:27`). The integration suite points the **tooling** at its
  throwaway container by passing `FEEDBACK_DB_URL` explicitly in the core's `env`; the
  tooling never reads a test var implicitly, so a routine host run can never drift onto a
  test database by accident.
- The URL is parsed with `new URL()` into `{ user, database }`; the client runs **inside
  the DB container over its trusted local socket**, so the URL's host, port, and password
  are intentionally not used. The URL is the single source of the database identity.
- **`--only` maps to Postgres database names.** In v1 the only valid value is the database
  named by the URL's path segment — `feedback`. Unknown names exit 1 before any write. The
  archived file is `<database>.dump` (`feedback.dump`), exactly as the SQLite variant names
  the file after the source (`life.db`).

### Naming, manifest, retention (mirrors the SQLite contract)

- Destination `backup/<UTC ISO stamp with : and . replaced by ->/`, computed once as
  `new Date().toISOString().replace(/[:.]/g, '-')` (for example
  `backup/2026-10-01T12-34-56-789Z/`); `backup/` resolves against `INIT_CWD ?? cwd`
  (`.gitignore:12` already reserves it). `--pin` appends `-pinned`.
- **`manifest.json`** top-level shape identical to SQLite
  (`mode`, `createdAt`, `pinned`, `databases[]`); each entry is
  `{ name, file, source, bytes, pgRestoreList: 'ok', tables }` where `name`/`source` are
  the database (`feedback`), `file` is `feedback.dump`, `bytes` is the archived size, and
  `pgRestoreList` replaces SQLite's `quickCheck`. `tables` records
  `Record<tableName, rowCount>` for every base table in `public` at dump time (the
  row-count comparison of the next section). `--pin` also writes an empty `PINNED` marker.
- **Modes:** `routine` (`db:backup:pg`), `deliberate` (`--pin`, dir `…-pinned`,
  `pinned: true`, `PINNED`), `pre-restore` (`db:restore:pg`, dir
  `backup/pre-restore-<stamp>/`, `pinned: true`, `PINNED`) — the same table as
  `SPEC-db-backup-restore.md` "Modes and naming".
- **Retention:** after a successful routine run, call the existing shared
  `pruneRoutineSnapshots(backupRoot)` from `src/backup.ts` unchanged (keep newest 10
  routine snapshots, best-effort, never prune `-pinned` / `PINNED` / `deliberate` /
  `pre-restore` / manifest-less directories). No fork of the retention logic (Contract 2
  Rule 4). The consequence — SQLite and Postgres routine snapshots share one
  `backup/` pool — is recorded in `## Decisions taken during Specify`.

### Backup behavior

`runBackupPg({ argv, env, runner, now })`:

1. Resolve the URL (`FEEDBACK_DB_URL`), parse `--only` (unknown → exit 1) and `--pin`.
2. Compute the stamp and the destination directory; refuse an existing destination.
3. For the selected database: `pg_dump -Fc --no-owner` **inside the DB container** to a
   unique container temp file (`/tmp/db-backup-<stamp>/<db>.dump`), then
   `pg_restore --list` it (the verification step), then record
   `SELECT COUNT(*)` per base table, then `docker compose cp` the archive out to the
   destination. The dump is a consistent read-only snapshot, so a routine run is safe with
   the stack up (the SQLite D4 parity).
4. Write `manifest.json`; for `--pin` also write `PINNED`.
5. Apply retention (routine runs only).
6. Print one line per database
   (`db:backup:pg [routine] feedback.dump -> backup/…/feedback.dump pg_restore_list=ok`) and
   return 0.

No prompt, no stdin read. A failure inside any step aborts before the destination is
declared complete.

### Restore behavior

`runRestorePg({ from, only, env, runner, probe, now })`:

1. Parse `--from` (required; a directory **under `backup/`** — resolved against
   `INIT_CWD ?? cwd`; an absolute path or one that escapes `backup/` exits 1) and `--only`.
2. **Preconditions, before any write:**
   - the selected `*.dump` exists, else exit 1;
   - `pg_restore --list` verifies it (`pg_restore_list=ok`), else exit 1, nothing replaced;
   - the probe reports the stack stopped (next section); up or unverifiable → exit 2.
3. Take a **verified, pinned pre-restore snapshot** of the live database (same
   `pg_dump -Fc` + `pg_restore --list` path) into
   `backup/pre-restore-<stamp>/feedback.dump`; a failure aborts before the target is
   touched.
4. Replace the live database: `psql -d postgres` →
   `DROP DATABASE IF EXISTS feedback;` then `CREATE DATABASE feedback OWNER feedback;`
   then `pg_restore --no-owner -d feedback <container path>`. A full drop/recreate mirrors
   SQLite's whole-file overwrite; it fails if any other client is connected, which the
   probe already rules out.
5. Write `manifest.json` (`mode: pre-restore`, `pinned: true`) into the pre-restore dir.
6. **Post-write verification:** compare each restored table's `SELECT COUNT(*)` against
   the snapshot manifest's `tables`. A mismatch exits 1 and prints the recovery path
   (`recover from backup/pre-restore-<stamp>/feedback.dump`). Success prints one line per
   restored database and returns 0.

Restoring `feedback` replaces the whole feedback store — the pre-restore snapshot is the
undo path and is pinned so retention never deletes it (the SQLite "no silent data loss"
guarantee).

### Restore safety check — "is the stack stopped"

The check is read-only; it never kills, stops, or restarts anything. It observes the
application **ports** and the Postgres **container**:

- **Ports:** open a plain TCP connection to `127.0.0.1:3002` (`app`) and
  `127.0.0.1:3003` (`idp`) with a one-second timeout, the same probe as the SQLite
  variant (`compose.yaml:159,211`). Accepted → `up`; `ECONNREFUSED` → `down`; any other
  error or timeout → `unknown`. `postgres-feedback`' own published `127.0.0.1:5432` is
  deliberately **not** a probe port: the restore runs its client inside that container,
  so the server has to be up — the connection count below is what covers it.
- **Container:** inside the `postgres-feedback` container, count other backends on the target
  database —
  `SELECT count(*) FROM pg_stat_activity WHERE datname = 'feedback' AND pid <> pg_backend_pid()`
  via `psql -d feedback`. `0` → `down`; non-zero → `up`; the query failing (container not
  running) → `unknown`. This stays the authoritative "database in use" signal:
  `feedback-service` itself publishes no host port, but it holds a Postgres connection —
  and now that `postgres-feedback` publishes `127.0.0.1:5432`, any host-side client (dev service,
  stray `psql`) shows up here too, so the count is the signal that cannot be bypassed.
- **Fails closed:** any port `up`, any probe `unknown`, or the connection count
  unavailable → print the reason and exit 2, touching nothing. Only "both ports refused
  **and** the database has no other client" is treated as stopped.

Because the client runs inside the DB container, the documented procedure leaves `postgres-feedback`
up and everything else down:

```bash
docker compose down
docker compose up -d postgres-feedback
npm run db:restore:pg -w @life/db -- --from backup/<stamp>
docker compose up -d
```

### The client inside the container

The host has no `psql`/`pg_dump`, so every Postgres client call is executed inside the DB
container. A `PgRunner` seam (injected like the SQLite `probe`) isolates this:

```ts
export interface PgRunner {
  /** Run argv inside the DB container; returns status + captured stdout/stderr. */
  exec(argv: string[]): { status: number; stdout: string; stderr: string };
  copyIn(hostPath: string, containerPath: string): void;
  copyOut(containerPath: string, hostPath: string): void;
}
```

- `createComposePgRunner({ composeFile, service: 'postgres-feedback' })` is the production default:
  it runs `docker compose -f <repo-anchored compose.yaml> exec -T postgres-feedback …` and
  `docker compose -f <compose.yaml> cp …`. `-T` disables TTY allocation, so nothing reads
  stdin.
- `createDockerPgRunner(containerName)` is used by the integration harness against its
  throwaway container (`docker exec …` / `docker cp …`).
- Unit tests inject a fake runner and never touch Docker.

Archives cross the boundary as files via `copyIn`/`copyOut` on unique container temp paths
(no binary over stdout, no CRLF risk).

### Exit codes and non-interactive contract

- `0` success; `1` usage / precondition / verification failure; `2` the stack appears up
  or its state cannot be verified.
- No prompt, no stdin read, no `process.exit`. Each thin entry
  (`scripts/backup-pg.ts`, `scripts/restore-pg.ts`) sets
  `process.exitCode = main()` (`packages/db/scripts/backup.ts:17`), and `main` returns the
  code.

## Cache Rules (AGENTS.md Contract 2 — N/A, with rationale)

This module has **no cache of its own**. `feedback-service` owns `redis-feedback` and its
read-through cache; this spec defines only the store (`postgres-feedback`), the broker
(`rabbitmq-feedback`), and the operator backup/restore tooling.

- **Cached shapes / key composition / invalidation / failure mode:** not applicable — no
  module in this spec reads or writes Redis. The backup/restore tooling opens the Postgres
  database directly (consistent `pg_dump` reads; drop/recreate writes), and the compose
  additions are infrastructure with no request path.
- **Why the deviation is correct rather than a shortcut:** Contract 2 puts Redis behind
  `feedback-service`'s read path; infrastructure and at-rest backup/restore sit outside it.
  Restore replaces the source of truth, which a cache must never absorb — its correctness
  is independent of any cache state.
- **Mechanical check:** `grep -rni "redis" packages/db/src` returns zero hits after this
  change (the SQLite tooling's existing check, kept green).

## Project Structure

```
packages/db/src/pg-client.ts             # PgRunner interface + compose/docker runners, URL parsing,
                                         #   pg_dump / pg_restore --list / table-count helpers
packages/db/src/backup-pg.ts             # runBackupPg core + CLI body
packages/db/src/restore-pg.ts            # runRestorePg core + CLI body
packages/db/scripts/backup-pg.ts         # thin CLI entry (sets process.exitCode)
packages/db/scripts/restore-pg.ts        # thin CLI entry (sets process.exitCode)
packages/db/test/backup-pg.test.ts       # fake runner + temp fixture dirs; no Docker
packages/db/test/restore-pg.test.ts      # injected runner + injected probe; no Docker
packages/db/test/pg-integration.test.ts  # throwaway Postgres container; skipped if Docker absent
```

Supporting edits (same change):

- `package.json` (root): the two `db:backup:pg` / `db:restore:pg` delegation scripts above.
- `packages/db/package.json`: the two `ts-node` scripts above.
- `packages/db/src/index.ts`: re-export `runBackupPg`, `runRestorePg`, `PgRunner`,
  `createComposePgRunner`.
- `compose.yaml`: the `postgres-feedback` + `rabbitmq-feedback` services and their two named volumes.
- `.env.example`: the two documented secret **names**.
- `pruneRoutineSnapshots` and `readManifest` in `src/backup.ts` are **reused, not
  copied**; `src/backup-pg.ts` imports `pruneRoutineSnapshots` unchanged.

## Code Style

Plain sequential steps with explicit aborts; the same `main(argv, env): number` /
`Promise<number>` shape and the same one-responsibility-per-module split as the SQLite
tooling (`SPEC-db-backup-restore.md` "Code Style"). `pg-client.ts` owns all Docker and
Postgres mechanics, `backup-pg.ts`/`restore-pg.ts` own orchestration only. Types at every
module boundary (`PgRunner`, manifest shape, parsed URL); no `any`; no `process.exit`, no
`readline`, no prompts.

## Testing Strategy

Unit tests use **temp fixture directories** under the OS temp dir (`mkdtempSync`) for the
`backup/` root and a **fake `PgRunner`** that records argv and returns canned stdout;
tests never touch Docker, `apps/*/data`, or a real port (the restore `probe` is injected).
The host has no `psql`/`pg_dump`, so the only place a real client runs is the container —
in production via `createComposePgRunner`, in the integration suite via
`createDockerPgRunner`.

Per the Project Profile, from the owning workspace:

```bash
npm run typecheck -w packages/db
npm run test:unit -w packages/db -- test/backup-pg.test.ts
npm run test:unit -w packages/db -- test/restore-pg.test.ts
npm run test:unit -w packages/db -- test/pg-integration.test.ts
```

Cover:

- **backup:** the destination stamp/naming and `-pinned` suffix; manifest shape
  (`mode`/`createdAt`/`pinned`/`databases[]`, `pgRestoreList: 'ok'`, `tables`); a `--pin`
  run writes `PINNED` and is distinguishable from a routine run by name and manifest; an
  unknown `--only` exits 1 before any write; retention prunes routine snapshots to the
  newest 10 and never prunes pinned/deliberate/pre-restore/manifest-less directories;
  `--only feedback` is accepted and the archived file is `feedback.dump`.
- **restore:** an injected probe reporting `up` or `unknown` exits 2 and replaces nothing;
  a `--from` outside `backup/` exits 1; a failing `pg_restore --list` exits 1 and replaces
  nothing; a verified pre-restore snapshot is taken before the target is dropped; a
  post-write row-count mismatch exits 1 and names the pre-restore recovery path; `--only`
  restores the subset; missing `--from` exits 1.
- **CLI:** stdin closed → no prompt, no hang; exit codes deterministic across repeated
  identical runs; `process.exitCode` set by the entry, never `process.exit`.
- **integration (`pg-integration.test.ts`):** `beforeAll` starts a throwaway Postgres
  (`docker run --rm -d --name feedback-pg-test -e POSTGRES_USER=postgres
  -e POSTGRES_PASSWORD=… -e POSTGRES_DB=feedback postgres:17-alpine`), waits for
  `pg_isready`, and uses `createDockerPgRunner('feedback-pg-test')`; it seeds a table,
  backs it up, mutates it, restores, and asserts the prior state returns (the undo proof)
  and the restored row count matches the manifest. `afterAll` force-removes the container.
  The suite is skipped, not failed, when Docker is unavailable, and never touches
  `apps/*/data` or the production compose services. When `FEEDBACK_TEST_DB_URL` is set it
  may point the harness at an already-running throwaway instead of starting one.

## Frozen surfaces (human-owned — this change touches none)

- The e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`).
- Token values (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md` value table).
- PWA constants (`public/manifest-*.json`, `viewport.themeColor`).

This change adds compose services, two documented secret names, and a backend/operator
workspace's CLI; no UI code, no selectors, no tokens, no PWA constants.

## Boundaries

- **Always:** give each component its own instance and named volume; expose `postgres-feedback` /
  `rabbitmq-feedback` on host loopback only (`127.0.0.1:5432`, `127.0.0.1:5672`) and keep every
  Redis instance internal-only (no host port);
  keep the exact var names `FEEDBACK_DB_URL`, `FEEDBACK_TEST_DB_URL`, `RABBITMQ_URL`;
  verify every snapshot with `pg_restore --list` and every restore with a row-count
  comparison; take and verify a pinned pre-restore snapshot before overwriting; fail
  closed on a missing/invalid input or an up/unknown probe; run every Postgres client
  inside a container; reuse `pruneRoutineSnapshots` (no fork); be non-interactive with
  exit codes 0/1/2; keep secrets out of logs and out of host argv.
- **Ask first:** exposing `postgres-feedback`/`rabbitmq-feedback` beyond host loopback or enabling the RabbitMQ
  management plugin; changing the retention count or the `backup/` root; extending the
  `--only` name set beyond the URL's database; adding a second Postgres or broker instance.
- **Never:** fork the snapshot or retention logic; run `pg_dump`/`pg_restore` from the host;
  kill/stop/restart a service from the script; point the tooling at `apps/*/data`; write
  plaintext credentials into docs or logs; change the e2e selector surface, token values,
  or PWA constants.

### Hard lines (human-run — documented, not executed by the agent)

Production deploy and any production data migration (including the SQLite→Postgres
data-tier move deferred by the intent) are hard lines. This spec documents the checklist;
the human runs it. At minimum:

- [ ] Stop the stack: `docker compose down` (NO `-v`). Bring `postgres-feedback` up for the tooling:
      `docker compose up -d postgres-feedback`.
- [ ] Take a deliberate backup: `npm run db:backup:pg -w @life/db -- --pin`, and confirm
      `pg_restore --list` reported `ok`. Rollback depends on it.
- [ ] Apply the migration (if any) with dry-run first, read the counts, then apply.
- [ ] `docker compose up -d --build`; `docker compose ps` shows every healthcheck green.
- [ ] Rollback: previous image tags + `npm run db:restore:pg -w @life/db -- --from <pinned
      stamp>` (old code and old data roll back together; a restore overwrites state).

## Success Criteria

1. `docker compose up -d postgres-feedback rabbitmq-feedback` starts both services with green healthchecks,
   each with its own named volume, and neither publishes a host port
   (`docker compose ps`/`docker compose config` confirm).
2. `compose.yaml` injects `FEEDBACK_DB_URL=postgresql://feedback:…@postgres-feedback:5432/feedback`
   and `RABBITMQ_URL=amqp://feedback:…@rabbitmq-feedback:5672` into `feedback-service`, and
   `feedback-service` declares `depends_on` with `condition: service_healthy` for
   `postgres-feedback`, `rabbitmq-feedback`, and `redis-feedback`.
3. The `postgres-feedback` service accepts `pg_notify`/`LISTEN` (a stock Postgres image; no custom
   config) so the `feedback-service` change-log dispatcher can hold a persistent listen.
4. `npm run db:backup:pg -w @life/db` writes `backup/2026-10-01T12-34-56-789Z/feedback.dump`
   plus `manifest.json` (`mode: routine`, `pgRestoreList: 'ok'`) and exits 0; `--pin` writes
   `…-pinned/` with a `PINNED` marker and is distinguishable by name and manifest alone.
5. After an 11th routine run, exactly the newest 10 routine snapshots remain and every
   pinned/deliberate/pre-restore snapshot is untouched.
6. `npm run db:restore:pg -w @life/db -- --from backup/2026-10-01T12-34-56-789Z` exits 2 and
   replaces nothing while the injected probe reports `3002`/`3003` up or the target database
   has another client; with the probe down it drops/recreates `feedback`, restores both the
   pre-restore snapshot (pinned) and the chosen archive, and the restored row counts match
   the manifest.
7. Restoring the pre-restore snapshot returns the database to its prior state (the undo
   proof).
8. Every command exits 0 on success and a documented non-zero code on failure with stdin
   closed; no prompt appears and no entry calls `process.exit`.
9. `npm run typecheck -w packages/db` and the two unit suites are green; the integration
   suite is green (or skipped when Docker is absent).
10. `grep -rni "redis" packages/db/src` returns zero hits (no cache in this module).

## Open Questions

None blocking. The exact `rabbitmq` minor tag (`4.1-alpine`) should be confirmed against
Docker Hub at implementation time; the `feedback-service` module owns adding
`redis-feedback` to the same compose change; and the Postgres data-tier migration remains
deferred per the intent.

## Decisions taken during Specify

1. **Retention stays one shared `backup/` pool; no `store` field is added.** The intent
   names "same `manifest.json` shape … newest-10 routine retention", so `backup/` holds one
   routine pool for both variants and `pruneRoutineSnapshots` is reused unchanged. Consequence:
   with a daily SQLite cron and a daily Postgres cron the newest 10 routine snapshots span
   both (§Success 5), and deliberate/pre-restore snapshots — the operator's real safety
   net — are never pruned. If independent pools are wanted later, add a `store` discriminator
   to the manifest and the prune predicate; recorded here rather than decided silently.
2. **Restore is a full drop/recreate of the `feedback` database, not
   `pg_restore --clean`.** It mirrors SQLite's whole-file overwrite and fails if another
   client is connected — which the DB-native probe already guarantees is not the case — at
   the cost of requiring the maintenance connection to `postgres`.
3. **The stack-down probe adds the DB-native connection count.** The SQLite probe's two
   host ports cannot observe `feedback-service` (it publishes no port), so the probe also
   counts other backends on the target database. It is still read-only and fails closed on
   any unknown, so an unverifiable state refuses rather than proceeds.
4. **The client runs over the container's local socket, so the URL's password is unused.**
   The connection URL is the single source of database identity (user + database); host,
   port, and password are required only by the app-side `FEEDBACK_DB_URL`, not by the
   operator tooling. This keeps the secret out of the tooling's argv and logs entirely.
