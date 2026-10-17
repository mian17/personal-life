# Production runbook — full stack (deploy `master` @ `eb3e152`)

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

Ref: `master` @ `eb3e152` (`merge: meal food catalog, manual logging and the Autosuggest
primitive`). `compose.yaml` defines **16 services**: 7 built images (`app`, `idp`,
`note-service`, `tags-service`, `todo-service`, `feedback-service`, `meal-service`) plus 7
Redis instances, `postgres-feedback` and `rabbitmq-feedback`.

**Run by a human. Deploy and every data migration are hard lines.** This document is the
checklist; it is not authority to run it.

## 0. Migration verdict

- **No migration framework or DDL files exist anywhere in the repo** — no `migrations/`
  directory, no `*.sql` outside `docs/reference-repo/`, no ormconfig, no migration
  `DataSource`. (Ad-hoc `new DataSource({...})` *does* appear in one-off note-service
  scripts — `scripts/encrypt-backfill.ts`, `scripts/rotate-master-key.ts`,
  `src/keys/backfill.ts` — none of which is a migration.) Schema is created at boot by
  TypeORM `synchronize: true` in all
  six data services: `apps/note-service/src/app.module.ts:17`,
  `apps/tags-service/src/app.module.ts:16`, `apps/todo-service/src/app.module.ts:25`,
  `apps/meal-service/src/app.module.ts:25`, `apps/feedback-service/src/app.module.ts:24`,
  `apps/idp/src/app.module.ts:18`.
- **Human-run data migrations exist, and the one-shot ones below have already run on this
  host:**

| Migration | Command | Status here |
|---|---|---|
| `import-tags` | `npm run import-tags -w @life/tags-service` (`apps/tags-service/package.json:13`) | **Applied.** `tags.db` holds 13 `tag` rows and `life.db` 15 `note_tag` refs; `backup/2026-10-01T11-38-29-059Z-pinned` (29 rows) brackets the import. Re-running is idempotent but pointless — do not. |
| `cleanup-tags` | `npm run cleanup-tags -w @life/tags-service` (`apps/tags-service/package.json:14`) | **Applied, after the pinned backup.** `tags.db.pre-cleanup-2026-10-01T11-41-59-916Z` holds the 29 pre-cleanup rows; the live table has 13. Do not re-run, and **do not restore `backup/2026-10-01T11-38-29-059Z-pinned`** expecting current tags — it predates the cleanup and would resurrect 16 orphans. |
| `backfill-content-updated-at` | `npm run backfill-content-updated-at -w @life/note-service` (`apps/note-service/package.json:11`) | **Applied.** `note.contentUpdatedAt` exists and no row is NULL. A re-run prints `stamped=0`. |

  Note-service also ships three more one-shot scripts that leave no dated artifact and are
  not part of a deploy: `scripts/encrypt-backfill.ts`, `scripts/rotate-master-key.ts`,
  `scripts/backfill-owner.ts` (`apps/note-service/package.json:9-12`). Never run
  `rotate-master-key` as a deploy step — see the write-once rule in §2.

- **One schema change lands with *this* deploy, by boot-time sync, not by hand:**
  `food.unit` (`apps/meal-service/src/foods/food.entity.ts:45-46`, `text NOT NULL DEFAULT
  'g'`) is absent from the live `meal.db`. It is additive-with-default only — no backfill,
  and the table currently holds 0 rows.
- **feedback Postgres is created on first boot.** Compose's `POSTGRES_DB: feedback` makes
  the database; `synchronize` makes its four tables (`feedback`, `feedback_event`,
  `feedback_cursor`, `user_keys`); the `feedback_events` NOTIFY trigger is re-ensured
  idempotently every boot (`apps/feedback-service/src/event/trigger-ddl.ts`). Nothing to
  declare, seed or create by hand.

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
| `postgres-feedback` | `postgres:17-alpine` | **published** `127.0.0.1:5432` | volume `postgres-feedback-data` |
| `rabbitmq-feedback` | `rabbitmq:4.1-alpine` | **published** `127.0.0.1:5672` | volume `rabbitmq-feedback-data` |
| `redis-app` | `redis:8-alpine` | — | volume `redis-app-data` (session store, AOF) |
| `redis-idp`, `redis-note`, `redis-tags`, `redis-todo`, `redis-meal` | `redis:8-alpine` | — | none (caches; RDB+AOF off) |
| `redis-feedback` | `redis:8-alpine` | — | volume `redis-feedback-data` (cache; RDB+AOF off) |

Facts that decide the steps below:

- **Five SQLite bind mounts**: `./apps/{note,tags,todo,meal}-service/data:/data` and
  `./apps/idp/data:/data`. `meal-service` writes `meal.db` (compose sets `DB_PATH:
  /data/meal.db` — the app module's `life.db` default is dev-only).
- **Only four ports leave the host**: `3002` (app), `3003` (idp), `5432`
  (postgres-feedback), `5672` (rabbitmq-feedback) — all `127.0.0.1`-only. `tailscale serve`
  proxies 443 → `127.0.0.1:3002` and 8443 → `127.0.0.1:3003`; the other four app services
  and every Redis are compose-network only.
- **Named volumes are never removed** by an ordinary `docker compose down`/`up`; only `-v`
  destroys them, and `-v` takes `redis-app-data` (sessions) with it.
- `app` is rebuilt by every deploy here: it carries the BFF base URLs
  (`TAGS_API_URL`, `TODO_API_URL`, `FEEDBACK_API_URL`, `MEAL_API_URL`) and
  `depends_on` all five backends.
- **New surface in this ref**: `feedback-service` + its three infra containers and two
  named volumes; the meals food catalog (`/meals/foods`, `/meals/foods/new`,
  `/meals/foods/[id]`), the manual-log door (`/meals/entry/new?door=food`) and the
  `Autosuggest` block in `packages/ui`; per-route PWA identity for `/meals` and
  `/feedback`.

## 2. Env (names only)

`.env` values never touch a doc, a log or a chat — only the **names** are here. Compose
reads the primary checkout's `.env` via `env_file: .env` (all seven built services).

**Compose refuses to start without these seven** (`${VAR:?…}`, `grep -n ':?' compose.yaml`):

| Var | Line | Notes |
|---|---|---|
| `NOTE_MASTER_KEY` | `compose.yaml:26` | 32-byte base64, own custody |
| `TAGS_MASTER_KEY` | `compose.yaml:63` | idem |
| `TODO_MASTER_KEY` | `compose.yaml:101` | idem |
| `FEEDBACK_MASTER_KEY` | `compose.yaml:151` | idem |
| `MEAL_MASTER_KEY` | `compose.yaml:193` | idem |
| `FEEDBACK_DB_PASSWORD` | `compose.yaml:472` | Postgres role password (`POSTGRES_PASSWORD`) |
| `FEEDBACK_RABBITMQ_PASSWORD` | `compose.yaml:494` | broker `feedback` user password |

Master-key rules, all five alike:

- Generate with `openssl rand -base64 32` — **once per service**, five distinct values,
  independent custody.
- Verify before pasting: `printf '%s' "$K" | base64 -d | wc -c` → `32`. The loader
  (`packages/crypto/src/keys.ts:110-128`) fails closed on anything else.
- **Write-once.** Changing a key makes that service's existing encrypted rows permanently
  undecryptable. Losing one loses that service's data.
- Never regenerate `NOTE_MASTER_KEY`, `TAGS_MASTER_KEY`, `TODO_MASTER_KEY`,
  `MEAL_MASTER_KEY` or `FEEDBACK_MASTER_KEY` on the running stack.

Passwords generated the same way (`openssl rand -hex 32`) must be set **before the first
boot** of `postgres-feedback`/`rabbitmq-feedback`: both are used as the server's
initialisation values, and changing them once `postgres-feedback-data` exists does not
change the stored role password.

Every other variable compose interpolates (names only):

`FEEDBACK_IDP_JWKS_URL`, `FEEDBACK_RABBITMQ_USER`, `FEEDBACK_SERVICE_AUDIENCE`,
`GEMINI_API_BASE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `IDP_ISSUER`, `MEAL_IDP_JWKS_URL`,
`MEAL_SERVICE_AUDIENCE`, `NOTE_SERVICE_AUDIENCE`, `NOTE_SERVICE_IDP_JWKS_URL`,
`OIDC_APP_CLIENT_ID`, `OIDC_APP_CLIENT_SECRET`, `OIDC_APP_REDIRECT_URI`,
`OIDC_APP_RESOURCE`, `OIDC_AUDIENCE_MAP`, `OIDC_DEFAULT_RESOURCE`, `TAGS_IDP_JWKS_URL`,
`TAGS_SERVICE_AUDIENCE`, `TODO_IDP_JWKS_URL`, `TODO_SERVICE_AUDIENCE`, `TODO_TIMEZONE`,
`TODO_VAPID_PRIVATE_KEY`, `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_SUBJECT`.

Two more reach containers through `env_file` without a compose default, so they are not in
the interpolation list: `USDA_API_KEY` / `USDA_API_BASE` (meal photo→USDA path) and
`OWNER_LOGIN` (app access gate, `apps/app/middleware.ts:45`).

- [ ] All seven fail-fast names are set in `.env`.
- [ ] Five master keys generated and verified as 32 decoded bytes, each distinct.
- [ ] **`OIDC_AUDIENCE_MAP` contains `https://meal-service=life-api`** — the compose
      default at `compose.yaml:245` now carries note/tags/todo/meal; a `.env` carried from
      an older deploy stops at `todo-service` and every meal API call answers 401. Value
      form (a **comma**-separated list) is at `.env.example:43`.
- [ ] The optional trios are present if you want the features: `GEMINI_API_KEY`,
      `GEMINI_MODEL`, `GEMINI_API_BASE` (all three, or the photo door answers
      `service-unavailable`) and `TODO_VAPID_PUBLIC_KEY`, `TODO_VAPID_PRIVATE_KEY`,
      `TODO_VAPID_SUBJECT` (unset keeps the reminder sweep off). The VAPID trio is in
      `.env.example:79-81`, commented out; **the `GEMINI_*` trio is not in
      `.env.example`** — its names appear in `docs/specs/SPEC-photo-identity.md:328` and in
      the `docs/runbooks/deploy-meal-{stack,nutrition,ingredients}.md` trio.
- [ ] Redis needs no keys: compose injects `REDIS_URL` per service.
- [ ] Leak discipline: a key's **value** never enters a doc, a log, an issue or a chat —
      names only. `USDA_API_KEY` rides a query string, so a logged URL is a leaked key.

## 3. Pre-flight

```bash
cd /home/night/WebstormProjects/personal-life
```

- [ ] Ref pinned: `git log -1 --oneline` → `eb3e152`; `git status --short` shows only
      untracked `docs/reference-repo/`, `pictures/`, `.pi/`.
- [ ] Record the images you are about to replace (rollback reference):
      `docker compose images`.
- [ ] Baseline the running stack: `docker compose ps` — the services you expect healthy
      before the change.
- [ ] Build preflight: `bash scripts/preflight-build.sh` → `preflight: ok — 1 dependency
      block across 7 Dockerfiles`. It asserts the seven Dockerfiles' `npm ci` dependency
      block hashes identically (one shared BuildKit layer; without dedupe the build runs
      seven monorepo installs and takes >30 minutes), that the daemon is reachable, and
      that the host has headroom (`PREFLIGHT_MIN_DISK_GB`, default `30`).
- [ ] `.env` satisfies §2 — in particular a value in every fail-fast slot.
- [ ] Compose interpolation resolves before building anything:
      `docker compose config >/dev/null` → exits 0 (it fails fast on a missing secret).
- [ ] The five SQLite `data/` directories exist (`apps/note-service/data`,
      `apps/tags-service/data`, `apps/todo-service/data`, `apps/meal-service/data`,
      `apps/idp/data`). Create any missing one yourself so Docker does not create it
      root-owned: `mkdir -p apps/meal-service/data` is the one that matters here.
- [ ] Published ports free on loopback: 3002, 3003, 5432, 5672 —
      `docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '3002|3003|5432|5672'` shows
      only containers you know about.
- [ ] Seeded IdP: `apps/idp/data/idp.db` already carries your user, so no `seed` step
      (§6) is needed. Seed only on a fresh host.

## 4. Stop and back up — destructive-window protection

```bash
docker compose down                 # NO -v : -v also removes redis-app-data (sessions)
npm run db:backup -w @life/db -- --pin
npm run db:backup:pg -w @life/db -- --pin
```

- `db:backup` snapshots the **five** SQLite databases (`life`, `tags`, `todo`, `idp`,
  `meal`) into `backup/<stamp>-pinned/`, each verified with `PRAGMA quick_check`. It is
  read-only against its inputs. `--only life,tags,todo,idp` narrows the set (needed only
  before `meal.db` exists — it does now).
- `db:backup:pg` dumps the feedback Postgres **from inside its container**, so it needs
  `postgres-feedback` up. If it does not exist yet (feedback never deployed), start just
  that service first (`docker compose up -d postgres-feedback`) or skip this line.
- [ ] Five `quick_check=ok` lines, a new `backup/<stamp>-pinned/` with a `PINNED` marker,
      or a `feedback.dump -> … pg_restore_list=ok` line from `db:backup:pg`.
- [ ] Retained until a routine backup lands on top of this stack. Rollback depends
      entirely on this — do not continue otherwise.
- [ ] `npm run db:backup:pg` on a first feedback deploy is skipped deliberately: an empty
      database is created in §6, and its first real snapshot is §8.

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
- [ ] Feedback schema and the NOTIFY trigger need no step: both are boot-ensured.

## 6. Deploy

```bash
docker compose up -d --build
```

- [ ] Ordering is enforced by `depends_on` + healthchecks: `redis-*` → the five backends
      plus `idp` → `app`. Do not start `app` ahead of its backends.
- [ ] Fresh host only: seed the IdP before booting the app —
      `NODE_ENV=production SEED_USERNAME=… SEED_PASSWORD=… npm run seed -w @life/idp`.
      On this host the identity DB is already seeded; the script refuses to overwrite an
      existing user.
- [ ] `docker compose ps` — all 16 services up; every service that declares a healthcheck
      reports `(healthy)`. `app` declares none (it is the last dependency, not a target).
- [ ] Any failure naming a `* is required` secret means §2 was not applied — fix `.env`
      and re-run the same `up`.

## 7. Verify

### Health and wiring

```bash
for s in note-service:3001 tags-service:3004 todo-service:3005 feedback-service:3008 meal-service:3106; do
  n=${s%%:*}; p=${s##*:}; printf '%s ' "$n"
  docker compose exec -T "$n" node -e "fetch('http://127.0.0.1:$p/health/ready').then(r=>console.log(r.status)).catch(()=>console.log('fail'))"
done
curl -fsS http://127.0.0.1:3002/ -o /dev/null -w 'app %{http_code}\n'
curl -fsS http://127.0.0.1:3003/health/ready -o /dev/null -w 'idp %{http_code}\n'
```

- [ ] Every readiness endpoint answers `200`; `app` answers on 3002.
- [ ] `docker compose ps` shows `postgres-feedback`, `rabbitmq-feedback`, `redis-feedback`
      and `feedback-service` healthy.
- [ ] Volume state after first feedback boot:
      `docker volume ls | grep -E 'postgres-feedback-data|rabbitmq-feedback-data'`.
- [ ] **Auth is on**: a tokenless internal request is 401 —
      `docker compose exec -T meal-service node -e "fetch('http://127.0.0.1:3106/api/foods').then(r=>console.log(r.status))"`
      → `401`.
- [ ] `docker compose logs feedback-service --since 3m` — master key accepted, Postgres
      connected, exchange `feedback` created, no JWKS/audience error. A short RabbitMQ
      retry while the broker finishes booting is expected; a permanent failure is not.
- [ ] `docker compose logs app --since 2m` — no BFF error for `/feedback`, `/meals`,
      `/todos` or `/notes`.

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

### Per-route PWA identity

```bash
for m in notes todos meals feedback; do
  printf '%s ' "$m"; curl -fsS "http://127.0.0.1:3002/manifest-$m.json" | head -c 60; echo
done
```

- [ ] All four manifests answer with their own `id`/`start_url`/`scope` (`/notes`,
      `/todos`, `/meals`, `/feedback`), and a signed-out visit to each returns to that
      same route.
- [ ] Hard-reload before concluding against a stale cached shell.

## 8. Steady state

- [ ] Both backup crons are installed and point at the primary checkout. Two lines, added
      by hand with `crontab -e` (never auto-installed):
      ```cron
      0 3 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
      0 4 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup:pg -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
      ```
      The first covers the five SQLite databases, the second the feedback dump.
- [ ] Take the first feedback Postgres snapshot now rather than letting the cron be the
      first thing that ever exercises it:
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
- [ ] **SQLite data** (all five databases):
      `npm run db:restore -w @life/db -- --from backup/<§4-stamp>-pinned`. It banks a pinned
      pre-restore snapshot of its own before overwriting anything.
- [ ] **Feedback Postgres data**, when that store is in scope — the only step that needs a
      server *up*: `docker compose up -d postgres-feedback` →
      `npm run db:restore:pg -w @life/db -- --from backup/<§8-stamp>-pinned` →
      `docker compose down`. The `pg_restore` runs **inside** the container, so
      `postgres-feedback` must be up while every client is down. The `--pin` in §8 means the
      snapshot directory always carries a `-pinned` suffix; `<§8-stamp>` without it does not
      exist and the restore exits 1.
- [ ] **Code**: `git checkout <the pre-merge ref you recorded in §3>`, then
      `docker compose up -d --build`.
- [ ] `meal.db` is additive on the way in, **not on the way back**: this deploy only adds
      the `food.unit` column, but TypeORM `synchronize` reconciles *down* as well, so older
      code booting against the new file drops it again. No user data is at risk (the live
      `food` table holds 0 rows). Leave the file in place; do not delete it, and do not
      delete `postgres-feedback-data` / `rabbitmq-feedback-data`.
- [ ] **There is no down-migration.** A restore replaces the whole file/database; it
      overwrites current state. That is the undo path.
- [ ] **Never** rotate or regenerate a master key during rollback; **never**
      `docker compose down -v`; **never** delete `apps/*/data/`, `backup/` or `.env`.

## Hard lines

No one else does these: merging to `master`, stopping the stack, running `import-tags` or
any backfill, `db:backup` / `db:backup:pg`, `db:restore` / `db:restore:pg`, `docker compose
up` against production, installing the crontab, and generating a master key. A key's
**value** never enters a doc, a log or a chat — names only.

## Superseded / historical runbooks

Per-chapter runbooks kept for their chapter-level detail, superseded by this one where they
disagree (they predate `master`'s current service set):

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
  containers where compose.yaml now defines 16, and its "zero migration" claim misses both
  human-run migrations of §0. Keep for history; do not follow.

Contracts: `docs/specs/SPEC-compose-build.md` (the shared build layer this runbook's
preflight pins), `docs/specs/SPEC-db-backup-restore.md` (SQLite backup/restore),
`docs/specs/SPEC-feedback-infra.md` (`db:*:pg`, Postgres/RabbitMQ, the cron lines),
`docs/specs/SPEC-service-kernel.md` (the shared `life-api` audience), and
`docs/specs/SPEC-food-units.md` (the `food.unit` change).
