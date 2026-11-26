# Production runbook — full stack

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

Authoritative deploy procedure for this host. Replaces the earlier
`master..refactor/notes-todos-shared-ui` runbook, which predates `feedback-service`,
`meal-service` and the `Autosuggest`/food-catalog work and would stop a stack that now
fails fast on secrets it never mentions.

Run entirely in the **primary checkout** — `/home/night/WebstormProjects/personal-life` —
where `.env`, `apps/*/data/*.db`, `backup/` and `compose.yaml` live. Every command below is
copy-pasteable from that directory:

```bash
cd /home/night/WebstormProjects/personal-life
```

Ref: the ref **you choose** — this runbook pins no hash. `dev` is the current line and
`main` lags it: `origin/main` was 141 commits behind `origin/dev` when this was written.
Check `git log --oneline -1 origin/dev` and what the ref you mean to ship actually
carries before choosing. Record the exact commit you deploy in §3.
`compose.yaml` defines **18 services**: 8 built images (`app`, `idp`,
`note-service`, `tags-service`, `todo-service`, `feedback-service`, `meal-service`,
`focus-service`) plus 8 Redis instances, `postgres-feedback` and
`rabbitmq-feedback`. `focus-service` stores its rows in SQLite
(`apps/focus-service/data/focus.db`), so it brings a cache and a bind mount but no
database server.

**Run by a human. Deploy and every data migration are hard lines.** This document is the
checklist; it is not authority to run it.

## 0. Migration verdict

- **No migration framework or DDL files exist anywhere in the repo** — no `migrations/`
  directory, no `*.sql` outside `docs/reference-repo/`, no ormconfig, no migration
  `DataSource`. (Ad-hoc `new DataSource({...})` *does* appear in one-off note-service
  scripts — `apps/note-service/scripts/encrypt-backfill.ts`,
  `apps/note-service/scripts/rotate-master-key.ts`,
  `apps/note-service/src/keys/backfill.ts` — none of which is a migration.) Schema is
  created at boot by TypeORM `synchronize: true` in all
  seven data services: `apps/note-service/src/app.module.ts:16`,
  `apps/tags-service/src/app.module.ts:15`, `apps/todo-service/src/app.module.ts:41`,
  `apps/meal-service/src/app.module.ts:53`, `apps/feedback-service/src/app.module.ts:23`,
  `apps/focus-service/src/app.module.ts:27`,
  `apps/idp/src/app.module.ts:18`.
- **Human-run data migrations exist, and the one-shot ones below have already run on this
  host:**

| Migration | Command | Status here |
|---|---|---|
| `import-tags` | `npm run import-tags -w @life/tags-service` (`apps/tags-service/package.json:14`) | **Applied.** `tags.db` holds 13 `tag` rows and `life.db` 15 `note_tag` refs; `backup/2026-10-01T11-38-29-059Z-pinned` (29 rows) brackets the import. Re-running is idempotent but pointless — do not. |
| `cleanup-tags` | `npm run cleanup-tags -w @life/tags-service` (`apps/tags-service/package.json:15`) | **Applied, after the pinned backup.** `tags.db.pre-cleanup-2026-10-01T11-41-59-916Z` holds the 29 pre-cleanup rows; the live table has 13. Do not re-run, and **do not restore `backup/2026-10-01T11-38-29-059Z-pinned`** expecting current tags — it predates the cleanup and would resurrect 16 orphans. |
| `backfill-content-updated-at` | `npm run backfill-content-updated-at -w @life/note-service` (`apps/note-service/package.json:12`) | **Applied.** `note.contentUpdatedAt` exists and no row is NULL. A re-run prints `stamped=0`. |

  Note-service also ships three more one-shot scripts that leave no dated artifact and are
  not part of a deploy: `apps/note-service/scripts/encrypt-backfill.ts`,
  `apps/note-service/scripts/rotate-master-key.ts`,
  `apps/note-service/scripts/backfill-owner.ts` (`apps/note-service/package.json:9-13`).
  Never run
  `rotate-master-key` as a deploy step — see the write-once rule in §2.

- **The one schema change this line carried has landed, by boot-time sync, not by hand:**
  `food.unit` (`apps/meal-service/src/foods/food.entity.ts:45-46`, `text NOT NULL DEFAULT
  'g'`) is present in the live `meal.db` and was populated by that default — 14 foods, `g`
  on 13 and `ml` on 1 — so it was additive-with-default only and no backfill is owed.
- **`db:backup:pg` is a working, already-used path.** `backup/` holds 28 pinned snapshot
  directories — 10 of them carrying `feedback.dump` — and two `pre-restore-*` snapshots
  (counted 2026-11-26); the newest pinned pair is `…2026-11-14T09-33-58-574Z-pinned`
  (Postgres) beside `…09-34-27-050Z-pinned` (SQLite), and the nightly cron has added
  routine snapshots on top since. So feedback Postgres has been deployed before and dumped
  before — the dump is part of a
  normal deploy, never a step to skip. Its schema is still boot-ensured rather than
  migrated: compose's `POSTGRES_DB: feedback` makes the database, `synchronize` makes its
  four tables (`feedback`, `feedback_event`, `feedback_cursor`, `user_keys`), and the
  `feedback_events` NOTIFY trigger is re-ensured idempotently every boot
  (`apps/feedback-service/src/event/trigger-ddl.ts`). Nothing to declare, seed or create by
  hand.
- **The focus store is new and it is a file, not a server.** `focus-service` is the
  sixth SQLite service: `compose.yaml` mounts `./apps/focus-service/data:/data` and sets
  `FOCUS_DB_PATH=/data/focus.db`. Its tables arrive by `synchronize` on the first boot and
  `db:backup` covers the file from that point on, so no Postgres server, no
  `FOCUS_DB_PASSWORD` and no `db:backup:pg` step exists for it. `db:backup:pg` keeps
  dumping `feedback` only.
- **Both §8 backup lines are installed and firing.** `crontab -l` carries them verbatim and
  `backup/cron.log` holds their output — the last entry is a `db:backup:pg [routine]` line —
  so scheduled backups are a running fixture here, not a first-time setup. Read the crontab
  before adding anything.

**Ordering is therefore: back up → migrate → boot. Never migrate after boot.**

## 1. What this deploy changes on the host

| Service | Build image | Host port | Store |
|---|---|---|---|
| `app` | `apps/app/Dockerfile` | **published** `127.0.0.1:3002` | `redis-app` sessions (AOF volume) |
| `idp` | `apps/idp/Dockerfile` | **published** `127.0.0.1:3003` | `apps/idp/data/idp.db` |
| `note-service` | `apps/note-service/Dockerfile` | internal `3001` | `apps/note-service/data/life.db` |
| `tags-service` | `apps/tags-service/Dockerfile` | internal `3004` | `apps/tags-service/data/tags.db` |
| `todo-service` | `apps/todo-service/Dockerfile` | internal `3005` | `apps/todo-service/data/todo.db` |
| `feedback-service` | `apps/feedback-service/Dockerfile` | internal `3008` | `postgres-feedback` (Postgres) |
| `meal-service` | `apps/meal-service/Dockerfile` | internal `3106` | `apps/meal-service/data/meal.db` |
| `focus-service` | `apps/focus-service/Dockerfile` | internal `3107` | `apps/focus-service/data/focus.db` |
| `postgres-feedback` | `postgres:17-alpine` | **published** `127.0.0.1:5432` | volume `postgres-feedback-data` |
| `rabbitmq-feedback` | `rabbitmq:4.1-alpine` | **published** `127.0.0.1:5672` | volume `rabbitmq-feedback-data` |
| `redis-app` | `redis:8-alpine` | — | volume `redis-app-data` (session store, AOF) |
| `redis-idp`, `redis-note`, `redis-tags`, `redis-todo`, `redis-meal` | `redis:8-alpine` | — | none (caches; RDB+AOF off) |
| `redis-feedback` | `redis:8-alpine` | — | volume `redis-feedback-data` (cache; RDB+AOF off) |
| `redis-focus` | `redis:8-alpine` | — | volume `redis-focus-data` (cache; RDB+AOF off) |

Facts that decide the steps below:

- **Six SQLite bind mounts**: `./apps/{note,tags,todo,meal,focus}-service/data:/data`
  and `./apps/idp/data:/data`. `meal-service` writes `meal.db` (compose sets `DB_PATH:
  /data/meal.db` — the app module's `life.db` default is dev-only); `focus-service` writes
  `focus.db` the same way. Containers run as `node` (uid 1000), so each `data/` directory
  must be writable by uid 1000 or the service cannot create its database.
- **Only four ports leave the host**: `3002` (app), `3003` (idp), `5432`
  (postgres-feedback), `5672` (rabbitmq-feedback) — all `127.0.0.1`-only. `tailscale serve`
  proxies 443 → `127.0.0.1:3002` and 8443 → `127.0.0.1:3003`; the other six app services
  and every Redis are compose-network only.
- **Named volumes are never removed** by an ordinary `docker compose down`/`up`; only `-v`
  destroys them, and `-v` takes `redis-app-data` (sessions) with it.
- The `app` service is rebuilt by every deploy here: it carries the BFF base URLs
  (`TAGS_API_URL`, `TODO_API_URL`, `FEEDBACK_API_URL`, `MEAL_API_URL`, `FOCUS_API_URL`)
  and `depends_on` all six backends. Without `FOCUS_API_URL` the pomodoro BFF falls back
  to container-local loopback and every `/pomodoro` session and goal call fails.
- **New surface in this ref**: `feedback-service` + its three infra containers and two
  named volumes; the pomodoro focus stack (`focus-service` + `redis-focus`, one more
  named volume — the database is a file under the existing SQLite bind-mount pattern, so
  no new published port); the meals food
  catalog (`/meals/foods`, `/meals/foods/new`, `/meals/foods/[id]`), the manual-log door
  (`/meals/entry/new?door=food`) and the `Autosuggest` block in `packages/ui`; per-route
  PWA identity for `/meals` and `/feedback`, and the pomodoro app (`/pomodoro`,
  `/pomodoro/settings`) carrying its own manifest. `apps/app/Dockerfile` copies
  `@life/pomodoro` into the `app` image, so the app-side half of pomodoro brings no
  container of its own; the service half is the focus stack above.
- **New in the feedback status workflow** (already in this pin — no step of its own): the
  `feedback.status` column, the `PATCH /api/feedback/:id` status route, the row status
  pill and dropdown in `/feedback`, the URL-param status filter
  (`/feedback?status=<open|in_progress|done|wont_do>`) and the gear entry to
  `/feedback/settings`. All additive: no new container, no new volume, no new env name,
  no new published port.

## 2. Env (names only)

`.env` values never touch a doc, a log or a chat — only the **names** are here. Compose
reads the primary checkout's `.env` via `env_file: .env` (all eight built services).

**Compose refuses to start without these eight** (`${VAR:?…}`, `grep -n ':?' compose.yaml`):

| Var | Line | Notes |
|---|---|---|
| `NOTE_MASTER_KEY` | `compose.yaml:26` | 32-byte base64, own custody |
| `TAGS_MASTER_KEY` | `compose.yaml:63` | idem |
| `TODO_MASTER_KEY` | `compose.yaml:101` | idem |
| `FEEDBACK_MASTER_KEY` | `compose.yaml:151` | idem |
| `MEAL_MASTER_KEY` | `compose.yaml:193` | idem |
| `FOCUS_MASTER_KEY` | `compose.yaml:247` | idem |
| `FEEDBACK_DB_PASSWORD` | `compose.yaml:537` | Postgres role password (`POSTGRES_PASSWORD`) |
| `FEEDBACK_RABBITMQ_PASSWORD` | `compose.yaml:559` | broker `feedback` user password |

Master-key rules, all six alike:

- Generate with `openssl rand -base64 32` — **once per service**, six distinct values,
  independent custody.
- Verify before pasting: `printf '%s' "$K" | base64 -d | wc -c` → `32`. The loader
  (`loadMasterKeyFromEnv()` in `packages/crypto/src/keys.ts`) fails closed on
  anything else.
- **Write-once.** Changing a key makes that service's existing encrypted rows permanently
  undecryptable. Losing one loses that service's data.
- Never regenerate `NOTE_MASTER_KEY`, `TAGS_MASTER_KEY`, `TODO_MASTER_KEY`,
  `MEAL_MASTER_KEY`, `FEEDBACK_MASTER_KEY` or `FOCUS_MASTER_KEY` on the running stack.

Passwords generated the same way (`openssl rand -hex 32`) must be set **before the first
boot** of `postgres-feedback`/`rabbitmq-feedback`: each is used as the server's
initialisation values, and changing them once `postgres-feedback-data` exists does not
change the stored role password.

Every other variable compose interpolates (names only):

`FEEDBACK_IDP_JWKS_URL`, `FEEDBACK_RABBITMQ_USER`, `FEEDBACK_SERVICE_AUDIENCE`,
`FOCUS_IDP_JWKS_URL`, `FOCUS_SERVICE_AUDIENCE`,
`GEMINI_API_BASE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `IDP_ISSUER`, `MEAL_IDP_JWKS_URL`,
`MEAL_SERVICE_AUDIENCE`, `NOTE_SERVICE_AUDIENCE`, `NOTE_SERVICE_IDP_JWKS_URL`,
`OIDC_APP_CLIENT_ID`, `OIDC_APP_CLIENT_SECRET`, `OIDC_APP_REDIRECT_URI`,
`OIDC_APP_RESOURCE`, `OIDC_AUDIENCE_MAP`, `OIDC_DEFAULT_RESOURCE`, `TAGS_IDP_JWKS_URL`,
`TAGS_SERVICE_AUDIENCE`, `TODO_IDP_JWKS_URL`, `TODO_SERVICE_AUDIENCE`, `TODO_TIMEZONE`,
`TODO_VAPID_PRIVATE_KEY`, `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_SUBJECT`.

Two more reach containers through `env_file` without a compose default, so they are not in
the interpolation list: `USDA_API_KEY` / `USDA_API_BASE` (meal photo→USDA path) and
`OWNER_LOGIN` (app access gate, `apps/app/proxy.ts:42`).

- [ ] All eight fail-fast names are set in `.env`.
- [ ] Six master keys generated and verified as 32 decoded bytes, each distinct.
- [ ] **`OIDC_AUDIENCE_MAP` contains `https://meal-service=life-api`** — the compose
      default at `compose.yaml:305` now carries note/tags/todo/meal; a `.env` carried from
      an older deploy stops at `todo-service` and every meal API call answers 401. Value
      form (a **comma**-separated list) is at `.env.example:52`.
- [ ] The optional trios are present if you want the features: `GEMINI_API_KEY`,
      `GEMINI_MODEL`, `GEMINI_API_BASE` (all three, or the photo door answers
      `service-unavailable`) and `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_PRIVATE_KEY`,
      `TODO_VAPID_SUBJECT` (unset keeps the reminder sweep off). The VAPID trio is in
      `.env.example:112-114`, commented out; **the `GEMINI_*` trio is not in
      `.env.example`** — its names appear in `docs/specs/SPEC-photo-identity.md:328` and in
      the `docs/runbooks/deploy-meal-{stack,nutrition,ingredients}.md` trio.
- [ ] Redis needs no keys: compose injects `REDIS_URL` per service.
- [ ] Leak discipline: a key's **value** never enters a doc, a log, an issue or a chat —
      names only. `USDA_API_KEY` rides a query string, so a logged URL is a leaked key.

## 3. Pre-flight

```bash
cd /home/night/WebstormProjects/personal-life
```

- [ ] Ref chosen and recorded: `git log -1 --oneline` → record the commit you are
      deploying. `dev` is the current line and `main` lags it (141 commits when this
      was written), so name the ref deliberately instead of defaulting to `main`. It must contain the feedback status workflow — check with
      `git log --oneline -1 d1f54c9^ -- docs/specs/SPEC-feedback-status.md` (a commit exists, not
      "unknown revision"). `git status --short` shows only untracked `docs/reference-repo/`,
      `pictures/`, `.pi/`.
- [ ] Record the images you are about to replace (rollback reference):
      `docker compose images`.
- [ ] Baseline the running stack: `docker compose ps` — the services you expect healthy
      before the change.
- [ ] Build preflight: `bash scripts/preflight-build.sh` → `preflight: ok — 1 dependency
      block across 8 Dockerfiles`. It asserts the eight Dockerfiles' `npm ci` dependency
      block hashes identically (one shared BuildKit layer; without dedupe the build runs
      eight monorepo installs and takes >30 minutes), that the daemon is reachable, and
      that the host has headroom (`PREFLIGHT_MIN_DISK_GB`, default `30`).
- [ ] Check whether the feedback volumes survive from the last deploy — this decides whether
      §6 continues the old Postgres/RabbitMQ store or initialises a fresh empty one:
      `docker volume ls | grep -E 'postgres-feedback-data|rabbitmq-feedback-data'`. Compose
      prefixes its own name (`docker compose config` → `name: personal-life`), so the real
      volume names are `personal-life_postgres-feedback-data` and
      `…_rabbitmq-feedback-data`. If they are absent, the store is **new**: the pinned
      `feedback.dump` snapshots become the only copy of any older rows (every manifest so far
      records `feedback: 0`, `feedback_event: 0`, so none is at risk), and no client holds
      stale cursor state.
- [ ] `.env` satisfies §2 — in particular a value in every fail-fast slot.
- [ ] Compose interpolation resolves before building anything:
      `docker compose config >/dev/null` → exits 0 (it fails fast on a missing secret).
- [ ] The six SQLite `data/` directories exist (`apps/note-service/data`,
      `apps/tags-service/data`, `apps/todo-service/data`, `apps/meal-service/data`,
      `apps/focus-service/data`, `apps/idp/data`) **and are owned by uid 1000** — containers
      run as `node`, so a root-owned directory fails the service on its first database
      write. Create any missing one yourself rather than letting Docker create it
      root-owned: `mkdir -p apps/meal-service/data`; repair an existing one with
      `chown -R 1000:1000 apps/*/data`.
- [ ] Published ports free on loopback: 3002, 3003, 5432, 5672 —
      `docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '3002|3003|5432|5672'` shows
      only containers you know about.
- [ ] Seeded IdP: `apps/idp/data/idp.db` already carries your user, so no `seed` step
      (§6) is needed. Seed only on a fresh host.

## 4. Stop and back up — destructive-window protection

The Postgres dump needs its server **up**; the SQLite dumps want their writers stopped. So
run them in that order — Postgres first, then stop everything, then the files.

```bash
# 1. feedback Postgres database, while its server still serves it
npm run db:backup:pg -w @life/db -- --pin

# 2. Stop the stack. NO -v : -v also removes redis-app-data (your sessions)
docker compose down

# 3. The six SQLite files, now quiescent
npm run db:backup -w @life/db -- --pin
```

- `db:backup:pg` dumps the one Postgres database — `feedback` (from `FEEDBACK_DB_URL`, or
  `DEFAULT_FEEDBACK_DB_URL`) — with `pg_dump -Fc --no-owner` run **inside its own
  container** (`postgres-feedback`). It verifies the archive with `pg_restore --list` and
  records per-table counts. The host deliberately has no `pg_dump` of its own, so this
  fails unless that container is running — bring it up and let it reach `(healthy)` first
  (`docker compose up -d postgres-feedback`). `--only feedback` is the whole set, so the
  flag changes nothing here. `focus-service` is not in this dump: its rows live in SQLite
  and arrive in step 3.
- `db:backup` snapshots the **six** SQLite databases (`life`, `tags`, `todo`, `idp`,
  `meal`, `focus`) into `backup/<stamp>-pinned/`, each verified with `PRAGMA quick_check`.
  It is read-only against its inputs. `--only life,tags,todo,idp` narrows the set (needed
  only before `meal.db` exists — it does now).
- Each run writes its own UTC-stamped directory, and `--pin` appends `-pinned` to the name.
  The two kinds land seconds apart in separate directories — the newest pair here is
  `…2026-10-16T12-34-08-493Z-pinned` (Postgres) and `…12-34-39-247Z-pinned` (SQLite).
- [ ] From `db:backup:pg`: one `-> … pg_restore_list=ok` line (for `feedback`) and a new
      `backup/<stamp>-pinned/` holding `feedback.dump`, `manifest.json` and a `PINNED`
      marker.
- [ ] From `db:backup`: six `quick_check=ok` lines, and a second `backup/<stamp>-pinned/`.
- [ ] Retained until a routine backup lands on top of this stack. Rollback depends
      entirely on this — do not continue otherwise.
- [ ] **The one permitted skip.** Only if `postgres-feedback` cannot be started at all,
      `db:backup:pg` is skipped, and the run says so out loud: the feedback store is
      created empty in §6 and its first real snapshot is §8. That is a deliberate, named
      gap — not the default. On this host Postgres *can* run, so take the dump.

      This skip does **not** extend to `focus`: `apps/focus-service/data/focus.db` is a
      file, so step 3 always covers it, including on a first-ever boot where it holds no
      rows yet.

## 5. Migration

Nothing must be migrated by hand in this ref. Do the two checks below so the claim is
verified rather than assumed, and do **not** re-run a migration that is already applied.

```bash
# 1. tags registry already migrated (rows, not an empty table)
node -e "const D=require('better-sqlite3');const db=new D('apps/tags-service/data/tags.db',{readonly:true});console.log(db.prepare('select count(*) c from tag').get())"

# 2. content-order backfill already stamped (expect 0 NULLs, then no-op on re-run)
node -e "const D=require('better-sqlite3');const db=new D('apps/note-service/data/life.db',{readonly:true});console.log(db.prepare('select count(*) c from note where contentUpdatedAt is null').get())"
```

- [ ] `tag` count > 0 and `contentUpdatedAt` NULL count `0` — the migrations have already
      run on this host. Leave them alone.
- [ ] If a **fresh host** were being stood up, the order would be: §4 backup →
      `NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> npm run import-tags -w
      @life/tags-service -- --dry-run`, then the same line without `--dry-run` →
      `npm run backfill-content-updated-at -w @life/note-service` → §6 boot. (Both resolve
      their DB paths from the repo root; `NOTE_DB_PATH`/`TAGS_DB_PATH` are optional
      overrides.) Not this run.
- [ ] `food.unit` needs no step: it is additive-with-default (`default 'g'`) and arrives
      with `synchronize` at `meal-service`'s first boot.
- [ ] `feedback.status` needs no step: it is additive-with-default (`default 'open'`, and
      its `CHK_feedback_status` check is built from the same shared vocabulary), so
      `synchronize` adds the column and the constraint at `feedback-service`'s first boot
      and every existing row reads `open` — which is a member of the vocabulary, so the
      check validates. No backfill and no manual `UPDATE`; a hand-written one would only
      race the constraint.
- [ ] Feedback schema and the NOTIFY trigger need no step: both are boot-ensured.

## 6. Deploy

```bash
docker compose up -d --build
```

- [ ] Ordering is enforced by `depends_on` + healthchecks: `redis-*` → the six backends
      plus `idp` → `app`. Do not start `app` ahead of its backends.
- [ ] Fresh host only: seed the IdP before booting the app —
      `NODE_ENV=production SEED_USERNAME=… SEED_PASSWORD=… npm run seed -w @life/idp`.
      On this host the identity DB is already seeded; the script refuses to overwrite an
      existing user.
- [ ] `docker compose ps` — all 18 services up; every service that declares a healthcheck
      reports `(healthy)`. `app` declares none (it is the last dependency, not a target).
- [ ] Any failure naming a `* is required` secret means §2 was not applied — fix `.env`
      and re-run the same `up`.

## 7. Verify

### Health and wiring

```bash
for s in note-service:3001 tags-service:3004 todo-service:3005 feedback-service:3008 meal-service:3106 focus-service:3107; do
  n=${s%%:*}; p=${s##*:}; printf '%s ' "$n"
  docker compose exec -T "$n" node -e "fetch('http://127.0.0.1:$p/health/ready').then(r=>console.log(r.status)).catch(()=>console.log('fail'))"
done
curl -fsS http://127.0.0.1:3002/ -o /dev/null -w 'app %{http_code}\n'
curl -fsS http://127.0.0.1:3003/health/ready -o /dev/null -w 'idp %{http_code}\n'
```

- [ ] Every readiness endpoint answers `200`; `app` answers on 3002.
- [ ] `docker compose ps` shows `postgres-feedback`, `rabbitmq-feedback`, `redis-focus`,
      and `feedback-service` / `focus-service` healthy.
- [ ] Volume state after boot — confirm the feedback pair and the focus cache volume now
      exist (compose prefixes its project name, so the real names are
      `personal-life_postgres-feedback-data`, `personal-life_rabbitmq-feedback-data` and
      `personal-life_redis-focus-data`):
      `docker volume ls | grep -E 'postgres-feedback-data|rabbitmq-feedback-data|redis-focus-data'`.
      If §3 found the feedback pair absent, they are created here for the first time. The
      focus store itself has no volume — it is `apps/focus-service/data/focus.db`, which
      must show up as a file on the host after boot.
- [ ] **Auth is on**: a tokenless internal request is 401 —
      `docker compose exec -T meal-service node -e "fetch('http://127.0.0.1:3106/api/foods').then(r=>console.log(r.status))"`
      → `401`.
- [ ] `docker compose logs feedback-service --since 3m` — master key accepted, Postgres
      connected, exchange `feedback` created, no JWKS/audience error. A short RabbitMQ
      retry while the broker finishes booting is expected; a permanent failure is not.
- [ ] `docker compose logs focus-service --since 3m` — `FOCUS_MASTER_KEY` accepted,
      `better-sqlite3` opened `/data/focus.db` (no `SQLITE_CANTOPEN`, no permission error),
      tables synced, no JWKS/audience error. `redis-focus` staying quiet is expected: the
      cache is fail-open, so a cache miss degrades to the loader rather than logging errors.
- [ ] `docker compose logs app --since 2m` — no BFF error for `/feedback`, `/meals`,
      `/todos`, `/pomodoro` or `/notes`.

### Notes (the ordering change is a real regression risk)

- [ ] `/notes`: create → open → save → trash → restore → permanent delete.
- [ ] **List ordered by last body edit**: create note A, create note B (B first), edit A's
      body, reload `/notes` → A is first (`notes.service.ts` ranks by
      `contentUpdatedAt ?? createdAt`).
- [ ] Tags still render in `/notes` (the earlier lane's data survived).
- [ ] Signed-out visit to `/notes` returns to `/notes`.

### Todos

- [ ] `/todos` list → status pills → list/tag filters → search → create → edit → save.
- [ ] Trash → restore → permanent delete on one todo.
- [ ] Signed-out visit to `/todos` returns to `/todos`.

### Meals

- [ ] `/meals/foods` → create a food (unit `g` or `ml`, per-100 facts, one named measure)
      → edit it: the unit renders read-only and a `PATCH` carrying `unit` is a 400 →
      delete it behind the confirm button; the food leaves the list.
- [ ] Manual multi-add: `/meals` → *Log food* (`/meals/entry/new?door=food`) → type ≥3
      characters (the `Autosuggest` `minChars` gate) → pick a row, pick a second row →
      two items in the editor → save. Row labels are food names, never UUIDs.
- [ ] Grams edit: change one item's amount, save, and the entry's nutrients scale with it.
- [ ] Logging a picked food adds an **entry**, not a catalog row: `/meals/foods` still
      lists the same number of foods.
- [ ] Photo door still works: `/meals/entry/new?door=photo` with an image resolves at
      least one item — or opens one empty row with a banner. With `GEMINI_*` unset the
      first estimate throws while building its client (a 500 the BFF maps to
      `service-unavailable`), so photo is expected unusable until §2's trio is set;
      manual entry must still work in that state.
- [ ] **The photo body reaches `meal-service`.** Use a *phone* photo (2–5 MB), not a
      test fixture: the BFF's Server Action ceiling in `apps/app/next.config.mjs` is
      what an oversized upload dies on, and it only shows at real size. The editor
      fills with items on success. If it instead shows `Photo service is unavailable.`,
      the body never left the BFF: check `docker compose logs app --since 2m | grep -i
      'body exceeded'` for the ceiling, and compare that number with `JSON_BODY_LIMIT` in
      `apps/meal-service/src/app.factory.ts` — the two must stay equal. (`meal-service`
      logs no successful request, so an absent line there proves nothing either way.)
- [ ] The banner names the failure: `Couldn't read that photo. Enter the meal by hand —
      nothing was guessed.` is a photo the model refused (send a better one);
      `Photo service is unavailable. Enter the meal by hand — nothing was guessed.` is
      the stack.
- [ ] `/meals` day list and saved meals render; a target day renders.
- [ ] Cache sanity: a second identical list read is served by `redis-meal`, and the
      surface still works with `redis-meal` stopped (fail-open).

### Feedback

- [ ] Toolbar feedback button → blank title blocks with `Title is required.`; a filled
      title + description submits, the dialog closes, the row appears in `/feedback`.
- [ ] Durable and non-plaintext:
      `docker compose exec -T postgres-feedback psql -U feedback -d feedback -tAc "SELECT left(title,7) FROM feedback LIMIT 1;"`
      → `enc.v1.`; `SELECT count(*) FROM feedback_event;` equals the number of submitted
      rows (one event per row).
- [ ] Cache sanity: a second `/feedback` load is served by `redis-feedback`, and the inbox
      still works with `redis-feedback` stopped.
- [ ] Signed-out visit to `/feedback` returns to `/feedback`.
- [ ] **Status pill renders per row.** Every row carries a pill reading `Open`,
      `In Progress`, `Done` or `Won't Do`, matching the row's stored status.
- [ ] **Status dropdown writes through.** Change a row's status → the dropdown updates,
      the pill above it re-renders with the new status, and a page reload keeps it.
- [ ] **Filter is a URL, and a link.** Click `Open` / `In Progress` / `Done` / `Won't Do` →
      the address becomes `/feedback?status=<value>` and only matching rows render; `All`
      drops the param. Filter pills are **links** (they navigate), not buttons.
- [ ] **Unknown or hand-typed status reads as All.** `/feedback?status=nonsense` renders
      the unfiltered inbox rather than an empty page or an error.
- [ ] **Gear opens settings.** The toolbar gear reaches `/feedback/settings`; back returns
      to `/feedback`.
- [ ] **Schema, one query** (proves the additive column and its check constraint arrived):
      `docker compose exec -T postgres-feedback psql -U feedback -d feedback -tAc "SELECT count(*) FILTER (WHERE status = 'open'), count(*) FROM feedback;"`
      → the first count equals the row count for a store never updated by hand (the
      `default 'open'`). `\d feedback` shows the column with default `'open'` and
      `CHK_feedback_status`.
- [ ] **Status is plaintext metadata, not content** — it rides the cache as plaintext
      alongside the `enc.v1.` payload, so `SELECT description FROM feedback` must still
      never leave the envelope; the status column is the only readable one added here.

### Pomodoro

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3002/pomodoro"
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3002/pomodoro/settings"
```

- [ ] Both answer `200` (signed-out visit redirects to the login route, same as
  every other protected page — it is not public).
- [ ] `/pomodoro` card fills the viewport, timer centred; `Start focus` starts it
  and the action row does not move.
- [ ] Settings page persists durations across a reload (stored as `pref_*` cookies,
  no migration, no new env name).
- [ ] Ships inside the `app` image — `apps/app/Dockerfile` copies
  `apps/pomodoro` in its build stage. Without that COPY the app image fails with
  `Module not found: Can't resolve '@life/pomodoro'`.
- [ ] `Pause` holds the remaining digits, `Resume` continues from them; `Reset` is
      confirm-gated, disabled before any progress exists, and reaches a finished focus so
      it can drop straight into the break.
- [ ] The phase-boundary beep plays once per boundary, not again on reload.
- [ ] **The focus store is really being written** (this deploy's new triple): finish a
      session, then read the row out of its own database file —
      `docker compose exec -T focus-service node -e "const D=require('better-sqlite3');console.log(new D('/data/focus.db',{readonly:true}).prepare('select count(*) c from focus_session').get())"`
      (goals live in `focus_goal`). A non-zero count proves `focus-service` → `focus.db`
      end to end. Zero rows after a completed session means the BFF is still on its
      `127.0.0.1:3107` fallback (`FOCUS_API_URL` unset) and every `/pomodoro` call failed
      inside the `app` container.
- [ ] Set a goal in `/pomodoro/settings`, reload, and confirm it survives — a write plus a
      read through `redis-focus`. Fail-open check: `docker compose stop redis-focus` must
      leave the page working (at most slower); `docker compose start redis-focus` after.
- [ ] Nothing decrypted sits in the cache: `docker compose exec -T redis-focus redis-cli --scan`
      lists keys only (`focus:<sub>:v<gen>:…`); the values are persisted rows, never DTOs.

### Per-route PWA identity

```bash
for m in notes todos meals feedback pomodoro; do
  printf '%s ' "$m"; curl -fsS "http://127.0.0.1:3002/manifest-$m.json" | head -c 60; echo
done
```

- [ ] All five manifests answer with their own `id`/`start_url`/`scope` (`/notes`,
      `/todos`, `/meals`, `/feedback`, `/pomodoro`), and a signed-out visit to each
      returns to that same route.
- [ ] Hard-reload before concluding against a stale cached shell.

## 8. Steady state

- [ ] Both backup crons are installed on this host, pointing at the primary checkout —
      **verify, do not re-install**: `crontab -l` carries the two lines below verbatim and
      `backup/cron.log` shows them firing. If a host ever lacks them, add them by hand with
      `crontab -e` (never auto-installed):
      ```cron
      0 3 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
      0 4 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup:pg -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
      ```
      The first covers the six SQLite databases, the second the one Postgres database
      (`feedback`).
- [ ] Take a Postgres snapshot once the stack is healthy, so the nightly cron is not the
      first thing that ever exercises `db:backup:pg`:
      `npm run db:backup:pg -w @life/db -- --pin`.
- [ ] Retention: newest 10 routine snapshots per kind; pinned and pre-restore snapshots
      never auto-pruned.
- [ ] Routine deploys from here on are §3 → §7 from the repo root with `--pin` on both
      backups. Keep §4's pinned snapshot until a routine backup lands on top of this stack.

## 9. Rollback

Code and data roll back together: older code cannot read an arrangement it never wrote.

- [ ] **Stop the stack first.** `db:restore` and `db:restore:pg` both probe ports
      3002/3003 and fail closed (**exit 2**, `StackRunningError`) on a live stack, so the
      SQLite restore cannot run while `app` and `idp` are up — and it would replace
      nothing. `docker compose down` (no `-v`) before any restore line below.
- [ ] **SQLite data** (all six databases):
      `npm run db:restore -w @life/db -- --from backup/<§4-stamp>-pinned`. It banks a pinned
      pre-restore snapshot of its own before overwriting anything.
- [ ] **Postgres data**, when the feedback store is in scope — the only step that needs a
      server *up*: `docker compose up -d postgres-feedback` →
      `npm run db:restore:pg -w @life/db -- --from backup/<§8-stamp>-pinned` →
      `docker compose down`. Each `pg_restore` runs **inside that database's own container**
      (`feedback` in `postgres-feedback`), so it must be up while every client is down;
      `--only feedback` is the whole set. The
      `--pin` in §8 means the snapshot directory always carries a `-pinned` suffix;
      `<§8-stamp>` without it does not exist and the restore exits 1.
- [ ] **Code**: `git checkout <the pre-merge ref you recorded in §3>`, then
      `docker compose up -d --build`.
- [ ] `meal.db` is additive on the way in, **not on the way back**: this deploy only adds
      the `food.unit` column, but TypeORM `synchronize` reconciles *down* as well, so older
      code booting against the new file drops it again. That column is not empty — 14 foods
      carry a unit, one of them `ml` — so the drop costs that value, not nothing. Leave the
      file in place; do not delete it, and do not
      delete `postgres-feedback-data` / `rabbitmq-feedback-data` / `redis-focus-data`.
- [ ] **`feedback.status` is not additive on the way back either**, and this one *does* drop
      user-entered state: older code booting against the same Postgres makes `synchronize`
      drop the column, taking every status with it (existing rows go back to "no such
      column", not to `open`). Nothing else in the feedback store is affected — the
      `enc.v1.` content columns and `feedback_event` rows survive. If statuses matter,
      restore the Postgres snapshot from §4 instead of rolling code back alone, so code and
      data go back together.
- [ ] **There is no down-migration.** A restore replaces the whole file/database; it
      overwrites current state. That is the undo path.
- [ ] If §6 initialised a **fresh** Postgres (the volume had been removed), an older
      `feedback.dump` in `backup/` restores into it with
      `docker compose up -d postgres-feedback` → `db:restore:pg` → `docker compose down`,
      and the pinned pre-restore snapshot that command takes is the undo path if the counts
      do not match.
- [ ] **Focus store**: this deploy *introduces* `apps/focus-service/data/focus.db`, so a
      code rollback leaves a file the older code never reads. Harmless, and the only reason
      it exists is a forward deploy; leave it in place and the next `up` picks it up. Do not
      delete it to "clean up" — it is the only copy of every pomodoro session recorded
      since this deploy (and the first one §4/§8 ever snapshot).
- [ ] **Never** rotate or regenerate a master key during rollback; **never**
      `docker compose down -v`; **never** delete `apps/*/data/`, `backup/` or `.env`.

## Hard lines

No one else does these: merging to `main` (the dev→main promotion), stopping the stack,
running `import-tags` or any backfill, `db:backup` / `db:backup:pg`, `db:restore` /
`db:restore:pg`, `docker compose up` against production, installing the crontab, and
generating a master key. A key's **value** never enters a doc, a log or a chat — names only.

## Superseded / historical runbooks

Per-chapter runbooks kept for their chapter-level detail, superseded by this one where they
disagree (they predate `main`'s current service set):

- `docs/runbooks/deploy-feedback-stack.md` — feedback-service + Postgres/RabbitMQ/Redis.
  Superseded by §2, §4, §6–§9 here; still the deepest drill detail for the feedback store.
- `docs/runbooks/deploy-meal-stack.md` — the meal stack chapter (meal-service, Redis, the
  3106 port). Superseded by §1, §4, §6–§9 here.
- `docs/runbooks/deploy-meal-nutrition.md` — the meal-service chapter before the unit
  change; the `food.unit` column this ref adds is in §0 here, not there.
- `docs/runbooks/deploy-meal-ingredients.md` — the photo→foods door. Its §2 no longer
  matches the picker (now `Autosuggest`, `minChars` 3) or the `/meals/foods` catalog UI.
- `docs/runbooks/deploy-completion-custom-repeat.md` — todo completion history + custom
  repeat. UI/chapter detail only.
- `docs/runbooks/deploy-done-reshape.md` — the Done reshape (`apps/app` + `packages/ui`).
- `docs/runbooks/deploy-timezone-today.md` — client-timezone today. UI/chapter detail only.
- `docs/runbooks/deploy-todos-ux-refinements.md` — Done ordering/quadrant/debounced search.
- `docs/runbooks/dev-meal-ingredients.md` — laptop rehearsal (`dev:seed`, `SEED_LOAD_DEV_ENV`),
  not a production path.
- `docs/intent/docker-deploy.md` — the original two-service intent (`api` 3003 + `web`
  3002, `API_TOKEN`/`OWNER_LOGIN` secrets, "zero migration"). **Stale**: it describes 2
  containers where compose.yaml now defines 18, and its "zero migration" claim misses both
  human-run migrations of §0. Keep for history; do not follow.

Contracts (all at `d1f54c9^`): `docs/specs/SPEC-compose-build.md` (the shared build layer this runbook's
preflight pins), `docs/specs/SPEC-db-backup-restore.md` (SQLite backup/restore),
`docs/specs/SPEC-feedback-infra.md` (`db:*:pg`, Postgres/RabbitMQ, the cron lines),
`docs/specs/SPEC-service-kernel.md` (the shared `life-api` audience), and
`docs/specs/SPEC-food-units.md` (the `food.unit` change).
