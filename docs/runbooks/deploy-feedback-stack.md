# Deploy runbook — feedback stack (deploy `master`)

Deploy ref: **`master` after merging `feat/app-feedback`** (39 commits).

Runs entirely in the **primary checkout** — `/home/night/WebstormProjects/personal-life` —
because that is where the live stack lives: `.env` (production secrets),
`apps/*/data/*.db` (the five live SQLite databases), `backup/` (pinned snapshots) and
`compose.yaml`. No worktree, no second checkout, **no data file is moved**.

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it.

## 0. Prerequisite — merge the branch into `master`

The branch is 39 commits ahead of `master` (`5be262b`), has no remote, and is currently
held by the worktree at `.worktrees/app-feedback`. Merging to `master` is **your** call and
needs your explicit go-ahead; nothing in this runbook merges.

```bash
cd /home/night/WebstormProjects/personal-life
git log -1 --oneline                              # record this: it is your rollback ref
git worktree remove .worktrees/app-feedback       # frees the branch (tree is clean)
git merge --no-ff feat/app-feedback
git branch -d feat/app-feedback
npm install                                       # new workspace apps/feedback-service
```

- [ ] The pre-merge `master` commit is recorded — §8 rolls back to it.
- [ ] Merge clean; `git status --short` shows only the untracked `docs/reference-repo/`
      and `pictures/` (leave both alone).
- [ ] `npm install` completed at the repo root.

Until this merge lands, do not deploy: `master` has **no** `feedback-service`, no
`postgres-feedback`/`rabbitmq-feedback`/`redis-feedback` compose services, and no `db:backup:pg`.

## 1. What this deploy changes on the host

One chapter arrives, and it has never run here:

1. **feedback-infra** — `postgres-feedback` and `rabbitmq-feedback`, the **first Postgres store and the first
   message broker on this host**, each with its own named volume, plus `redis-feedback`.
2. **feedback-service** — the ingest service (`POST`/`GET /api/feedback`) that owns them.
3. **feedback-ui** — the shared submit dialog (`FeedbackNavItem` in the Notes/Todos/Meals
   toolbars), the `/feedback` owner inbox, and its per-route PWA identity.

Facts that decide the steps below:

- **Four new containers** (`feedback-service`, `postgres-feedback`, `rabbitmq-feedback`, `redis-feedback`) and
  **two new named volumes** (`postgres-feedback-data`, `rabbitmq-feedback-data`). No existing block moves
  except `app`, which gains `FEEDBACK_API_URL: http://feedback-service:3008` and
  `depends_on: feedback-service`.
- **No migration files exist repo-wide.** The database named by `FEEDBACK_DB_URL` exists
  because Compose set `POSTGRES_DB: feedback`; the service's own TypeORM sync
  (`synchronize: true`) then creates the tables — `feedback`, `feedback_event`,
  `feedback_cursor`, `user_keys` — inside it. The five SQLite databases are untouched; no
  service syncs another's store.
- The `feedback` topic exchange and the `feedback_events` NOTIFY trigger are **boot-ensured**
  and idempotent (`assertExchange` on the durable exchange; `trigger-ddl.ts`). There is
  nothing to declare, seed, or create by hand in RabbitMQ or Postgres.
- **The feedback store starts empty.** The rows created while testing the form live in the
  *worktree's* Compose project (`app-feedback_postgres-data`); this checkout's project is
  `personal-life`, so its `personal-life_postgres-feedback-data` is a fresh volume. Dev feedback is
  throwaway — it is not migrated, and nothing needs to be.
- The Postgres backup/restore pair (`db:backup:pg` / `db:restore:pg` in `@life/db`) already
  exists, is unit-tested, and is proven against a throwaway container
  (`packages/db/test/pg-integration.test.ts`). Nothing has to be implemented for this
  deploy — §7 puts it to work.
- The other backends, the existing Redis instances, and every `.env` secret that already
  exists are untouched. Only the three names in §2 are new.

## 2. Env (names only)

`.env` values never touch a doc — only the **names** are here. Edit the primary checkout's
`.env` directly (compose reads it via `env_file: .env`).

| Var | Required? | Notes |
|---|---|---|
| `FEEDBACK_MASTER_KEY` | **yes — hard fail-fast** | 32-byte base64 content key, own custody. Compose refuses to start without it (`${FEEDBACK_MASTER_KEY:?…}`) and the service also refuses to boot. Generate: `openssl rand -base64 32`. Verify before pasting: `printf '%s' "$K" \| base64 -d \| wc -c` → `32`. **Write-once.** `title` and `description` are stored as `enc.v1.` envelopes; losing this key loses every feedback entry permanently, and regenerating it makes existing rows undecryptable. Back it up outside the repo with the other master keys. |
| `FEEDBACK_DB_PASSWORD` | **yes — hard fail-fast** | Password for Postgres' `feedback` role. It is used **both** to build `FEEDBACK_DB_URL` and as `POSTGRES_PASSWORD`, so the server initialises the role with it — **set it before the first boot**. Changing it after `postgres-feedback-data` exists does not change the role's stored password: the service would then fail to authenticate, and you would have to run `ALTER USER` inside the container. Generate: `openssl rand -hex 32`. |
| `FEEDBACK_RABBITMQ_PASSWORD` | **yes — hard fail-fast** | Password for the `feedback` broker user (`RABBITMQ_DEFAULT_PASS`). Same first-boot rule as above. Generate: `openssl rand -hex 32`. |

- [ ] **No `OIDC_AUDIENCE_MAP` change is needed.** The app requests one resource
      (`OIDC_APP_RESOURCE`, default `https://note-service`) and holds a single shared
      `life-api` audience — "no per-service audience or token exists here"
      (`apps/app/lib/client.ts:13-14`) — and `feedback-service` accepts `life-api`
      (`FEEDBACK_SERVICE_AUDIENCE`, `compose.yaml:148`). A `feedback-service` entry is
      unnecessary; it is not a missing prerequisite.
- [ ] **No `FEEDBACK_DB_URL` entry is needed either.** Compose builds it from
      `FEEDBACK_DB_PASSWORD`; the backup tool only parses it for the database identity and
      falls back to the same `postgresql://feedback@postgres-feedback:5432/feedback` default.
- [ ] Redis needs no keys: compose injects `REDIS_URL` (`redis://redis-feedback:6379`).
- [ ] Leak discipline: these three values are secrets. Names in the doc, values only in
      `.env` — never in a log, an issue, or a chat.

## 3. Pre-flight

```bash
cd /home/night/WebstormProjects/personal-life
```

- [ ] Ref pinned and clean: `git log -1 --oneline` → the merge commit;
      `git status --short` → only `docs/reference-repo/` and `pictures/` untracked.
- [ ] Record the images you are about to replace (rollback reference):
      `docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life`
- [ ] Baseline the running stack: `docker compose ps` — the services you expect healthy.
- [ ] **Build the new image first.** It is the deploy step most likely to fail, and it fails
      on its own:
      ```bash
      docker compose build feedback-service
      ```
      The Dockerfile's `npm ci` stage copies a **subset** of workspace `package.json` files;
      if it dies on a missing workspace, add the missing `COPY <path>/package.json <path>/`
      line to `apps/feedback-service/Dockerfile` and rebuild. `npm run build -w
      @life/feedback-service` in the build stage is the second failure point.
- [ ] **Host loopback ports free:** `postgres-feedback` and `rabbitmq-feedback` publish `127.0.0.1:5432` and
      `127.0.0.1:5672`. A stray container from another Compose project holding either would
      make the new ones fail to start:
      `docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '5432|5672'`
      → nothing (or only containers you know about). Stop any unrelated holder first.
- [ ] `.env` carries the three names from §2.
- [ ] **No data directory to create.** Unlike the SQLite services, `feedback-service` uses
      the Postgres named volume — there is no `apps/feedback-service/data/` bind mount, and
      nothing should be `mkdir`-ed for it.

## 4. Back up — the five SQLite databases, pinned

The feedback store does not exist yet on this checkout, so there is no feedback data to
snapshot (§1). What the deploy *can* disturb is the existing chapters: `app` is rebuilt and
reconfigured, so take a deliberate, pinned snapshot first.

```bash
npm run db:backup -w @life/db -- --pin
```

- [ ] Five `quick_check=ok` lines and a new `backup/<stamp>-pinned/` directory with a
      `PINNED` marker. Rollback of the existing chapters depends entirely on this.
- [ ] Do **not** continue otherwise.
- [ ] Postgres is deliberately **not** covered here: `db:backup:pg` targets a live
      `postgres-feedback` container, and this deploy is about to create an empty one. Its first
      real snapshot is §7.

## 5. Deploy

```bash
docker compose up -d --build app feedback-service
```

Only `app` and `feedback-service` are named: `app` changed and `feedback-service` is new.
`postgres-feedback`, `rabbitmq-feedback`, and `redis-feedback` come up with them through `depends_on`
(feedback-service waits on `postgres-feedback` + `rabbitmq-feedback` + `redis-feedback` being healthy; `app`
waits on `feedback-service`). `redis-app` (the session store, AOF + named volume) is never
touched, so **existing logins survive** — nothing forces a re-login.

- [ ] `docker compose ps` — the existing services plus `postgres-feedback`, `rabbitmq-feedback`,
      `redis-feedback`, and `feedback-service` (new) all up, healthchecks green
      (`/health/ready` on 3001/3004/3005/3106/3008, 3003 idp).
- [ ] `docker compose logs feedback-service --since 3m` — `FEEDBACK_MASTER_KEY` accepted,
      Postgres connected, `exchange "feedback"` created, no JWKS/audience error, no
      unhandled exception. A RabbitMQ retry line while the broker finishes booting is
      expected; a permanent failure is not.
- [ ] `docker compose logs app --since 2m` — no `/feedback` BFF error.
- [ ] `personal-life_postgres-feedback-data` and `personal-life_rabbitmq-feedback-data` now exist:
      `docker volume ls | grep -E 'postgres-feedback-data|rabbitmq-feedback-data'`.

If `up` fails on `FEEDBACK_MASTER_KEY is required`, `FEEDBACK_DB_PASSWORD is required`, or
`FEEDBACK_RABBITMQ_PASSWORD is required`, §2 was not applied — fix `.env` and re-run the same `up`.
If Postgres starts but `feedback-service` cannot authenticate, `FEEDBACK_DB_PASSWORD` was
changed after the volume was first created (§2).

## 6. Verify

Port `3008` is **not** published to the host — the two checks that touch the service run
from inside its container. Everything else is done in the browser.

New surface:

- [ ] `docker compose ps` shows `feedback-service` `(healthy)`; its healthcheck hits
      `127.0.0.1:3008/health/ready` internally.
- [ ] Auth: a tokenless request to `/api/feedback` is **401** (JWT-only, `aud: life-api`):
      ```bash
      docker compose exec feedback-service node -e "fetch('http://127.0.0.1:3008/api/feedback').then(r=>console.log(r.status))"
      ```
- [ ] **Submit one entry** from the toolbar feedback button in `/notes`: blank title blocks
      with `Title is required.` and does not call the service; a filled title + description
      submits, the dialog closes, and the row appears in `/feedback` under *Notes → Feature
      request*.
- [ ] **Durability (the reason for the broker):** the row is in Postgres —
      ```bash
      docker compose exec postgres-feedback psql -U feedback -d feedback -c 'SELECT count(*) FROM feedback;'
      ```
      → `1`; the event landed too (`SELECT count(*) FROM feedback_event;` → `1`). Then
      restart the service, hard-reload `/feedback`, and the row is still there.
- [ ] **No plaintext at rest:** the stored `title` reads as an `enc.v1.` envelope, not your
      words —
      ```bash
      docker compose exec postgres-feedback psql -U feedback -d feedback -tAc "SELECT left(title, 7) FROM feedback LIMIT 1;"
      ```
      → `enc.v1.`.
- [ ] **Idempotency:** the row you submitted has exactly one `feedback_event` —
      ```bash
      docker compose exec postgres-feedback psql -U feedback -d feedback -tAc "SELECT count(*) FROM feedback_event WHERE feedback_id = '<the id>';"
      ```
      → `1`. A submit retry with the same `id` is a no-op (still one row, still one event).
- [ ] **Per-route PWA:** `/feedback` loads its own manifest
      (`/manifest-feedback.json`, `start_url`/`scope` `/feedback`), and a signed-out visit
      to `/feedback` returns to `/feedback`.
- [ ] Cache sanity: a second `/feedback` load is served by `redis-feedback`, and the inbox
      still works with `redis-feedback` stopped (fail-open).

Existing surface (prove the deploy did not regress what already worked):

- [ ] `/notes` create → open → save → trash → restore.
- [ ] `/todos` list → filters → create → edit → save.
- [ ] `/meals` opens and a saved meal renders.
- [ ] Tags still render in `/notes`.
- [ ] Signed-out visits still return to their own route.

## 7. Steady state

- [ ] **Install the Postgres backup cron.** The SQLite cron from the earlier lane covers
      the five SQLite databases only; `backup/` now also needs the feedback dump. Add this
      second line with `crontab -e` (documented, never auto-installed —
      `SPEC-feedback-infra.md` "Commands"):
      ```cron
      0 4 * * * bash -lc 'cd /home/night/WebstormProjects/personal-life && mkdir -p backup && npm run db:backup:pg -w @life/db' >> /home/night/WebstormProjects/personal-life/backup/cron.log 2>&1
      ```
- [ ] **Take the first Postgres snapshot now**, so the cron is not the first thing that ever
      exercises it:
      ```bash
      npm run db:backup:pg -w @life/db -- --pin
      ```
      → one `feedback.dump -> backup/<stamp>-pinned/feedback.dump pg_restore_list=ok` line
      and a manifest recording per-table counts. Retention keeps the newest 10 routine
      snapshots and never prunes a pinned/pre-restore one. Record the stamp — the drill
      below needs it.
- [ ] **Run the restore drill once, now, while the data is still disposable.** This is the
      only way to know the undo path works before you need it.
      1. Submit a **second**, throwaway entry from the toolbar, then confirm count `2`:
         ```bash
         docker compose exec postgres-feedback psql -U feedback -d feedback -tAc 'SELECT count(*) FROM feedback;'
         ```
      2. Stop the stack — **without `-v`** (`-v` would also remove `redis-app-data`,
         the session store):
         ```bash
         docker compose down
         ```
      3. Start the database server **alone**. The restore tool runs `pg_restore` *inside*
         the postgres container (`docker compose exec postgres-feedback …`), so the container must
         be up while every client is gone. `down` already guarantees the clients are gone;
         the tool's own probe fail-closes (exit 2) if anything answers on 3002/3003 or any
         other connection reaches the `feedback` database.
         ```bash
         docker compose up -d postgres-feedback
         npm run db:restore:pg -w @life/db -- --from backup/<the §7-stamp>
         ```
         The tool banks a verified, pinned pre-restore dump of the 2-row state first (the
         undo of the undo), then replaces the database and compares the restored counts
         against the snapshot manifest.
      4. Bring the stack back and confirm the throwaway entry is gone — that disappearance
         is the PASS signal:
         ```bash
         docker compose up -d
         docker compose exec postgres-feedback psql -U feedback -d feedback -tAc 'SELECT count(*) FROM feedback;'
         ```
         → `1`. The §6 entry is back; the drill entry is not.
- [ ] Keep §4's pinned SQLite snapshot until a routine `db:backup` lands on top of this
      stack.

## 8. Rollback

Do the data steps **before** the code step: the pre-merge `compose.yaml` knows no
`postgres-feedback` service, so `db:restore:pg` can only run on this tree.

- [ ] **Stack stopped:** `docker compose down` — **never `-v`** (volumes keep the current
      data intact while you work). Every container is gone; sessions, SQLite files, and
      the feedback store all persist in their volumes.
- [ ] **Data (SQLite):**
      `npm run db:restore -w @life/db -- --from backup/<§4-stamp>-pinned`.
- [ ] **Data (feedback):** start the database server alone, restore, stop again:
      ```bash
      docker compose up -d postgres-feedback
      npm run db:restore:pg -w @life/db -- --from backup/<§7-stamp>
      docker compose down
      ```
      There is no down-migration; a restore replaces the whole feedback database, and the
      tool banks a pinned pre-restore dump first.
- [ ] **Code:** `git checkout <the pre-merge ref recorded in §0>`, then
      `docker compose up -d --build app`. The five SQLite databases were never converted
      and the feedback store only ever gained rows, so older code reads current data.
- [ ] **`postgres-feedback-data` / `rabbitmq-feedback-data`:** the `down`s never removed them — named
      volumes persist unless `-v` is passed. The restored feedback store sits in them,
      inert, ignored by the old stack. To retire the chapter entirely you would remove
      the compose blocks and the volumes by hand; that is out of scope here and is a
      hard line.
- [ ] **Never** rotate or regenerate `FEEDBACK_MASTER_KEY`; **never** `docker compose
      down -v`; **never** delete `apps/*/data/`, `backup/`, or `.env`.

## Hard lines

No one else does these: merging to `master`, stopping the stack, `db:backup` /
`db:backup:pg`, `db:restore` / `db:restore:pg`, `docker compose up` against production,
installing the crontab, generating a master key. A key's **value** never enters a doc, a
log, or a chat — names only.

## Related (kept, not replaced)

- `docs/runbooks/deploy-meal-stack.md` — the newest full-stack procedure; this runbook
  follows its shape and only adds what feedback changes (Postgres, broker, `db:*:pg`).
- `docs/runbooks/production-deploy.md` — the baseline stack and `import-tags` (already run
  on this host). It predates feedback and meal; treat the per-chapter runbooks as
  authoritative where they disagree.
- Contracts: `docs/specs/SPEC-feedback-infra.md` (compose additions, `db:*:pg` commands,
  naming, retention, restore safety, exit codes, the cron line),
  `docs/specs/SPEC-feedback-service.md` (data model, event stream, cache rules),
  `docs/specs/SPEC-feedback-ui.md` (form + inbox), `docs/specs/SPEC-db-backup-restore.md`
  (the SQLite contract `db:*:pg` mirrors).
- Ledger: `tasks/todo-feedback.md`.
