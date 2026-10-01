# Production runbook — Lane B deploy (`master..refactor/notes-todos-shared-ui`)

Scope: 102 commits — the `feature/todo-ecosystem` chapter (todo-service, tags-service,
per-route PWA identity) **plus** the shared-page-blocks refactor. Stack is `compose.yaml`
(frontend `app` on `127.0.0.1:3002`, `idp` on `127.0.0.1:3003`).

**Run by a human. Deploy and migration are hard lines.**

## 0. Migration verdict

- **No schema/DDL migration files exist** anywhere in the repo: no `migrations/`, no
  `*.sql`, no prisma/knex/typeorm/drizzle config. Schema is created at boot by TypeORM
  `synchronize: true` (`apps/note-service/src/app.module.ts:13-18`, same pattern in
  `tags-service`, `todo-service`, `idp`). Booting a service creates its tables.
- **One human-run data migration exists**, and it is the reason "migration first?" is
  *yes* for this lane: `import-tags` moves note-DB tag rows into the new `tags-service`
  registry, re-encrypts them, and drops the legacy `tag` table. Without it, `/notes`
  tag data is absent from the new registry and `TagRef` finds nothing.
- The shared-page-blocks refactor (the latest 18 commits) needs **no** migration — it is
  frontend only.

**Ordering is therefore: backup → migrate → boot. Never migrate after boot.**

## 1. Pre-flight

- [ ] Decide the ref: `refactor/notes-todos-shared-ui` at `a333dd4` (unmerged; merging to
      `master` is a separate, deliberate decision).
- [ ] **Frontend image must carry `@life/app-kit`** — fixed in `a333dd4`
      (`apps/app/Dockerfile` two `COPY` stages + runtime safety net;
      `apps/app/next.config.mjs` `transpilePackages`). Without it `next build` fails on
      `Cannot find module '@life/app-kit'`.
- [ ] `.env` has these **NAMES** set (values never touch a doc):
      `NOTE_MASTER_KEY`, `TAGS_MASTER_KEY`, `TODO_MASTER_KEY`, `IDP_ISSUER`,
      `OIDC_APP_CLIENT_SECRET`, `OIDC_APP_REDIRECT_URI`, `REDIS_URL`.
- [ ] **`OIDC_AUDIENCE_MAP` must be UPDATED, not just present** — a `.env` carried over
      from the pre-ecosystem deploy holds the stale `…=note-service` map, and because
      `.env` beats the compose default (`compose.yaml:147`) the IdP keeps minting
      `aud: note-service` while every service now requires `life-api`
      (`compose.yaml:20`, `SPEC-service-kernel.md:81-96`). Symptom: the stack boots
      clean, then `/notes` renders a repeating `ApiError: API 401 on /api/notes`
      (the app forwards the session token — `apps/app/lib/client.ts:27,34` — and
      note-service maps every verification failure to a bare 401 with no log line,
      `apps/note-service/src/auth/auth.guard.ts:85-88`). Set it to the comma-separated
      value from `.env.example:43`:
      `https://note-service=life-api,https://tags-service=life-api,https://todo-service=life-api`
      (separator is a **comma** — `apps/idp/src/oidc/access-token.policy.ts:17,25`).
      Verify the two sides agree:
      `docker compose config | grep -E 'OIDC_AUDIENCE_MAP|NOTE_SERVICE_AUDIENCE'`
      → the map's value for `https://note-service` must equal `NOTE_SERVICE_AUDIENCE`.
- [ ] **New secrets this lane requires:** `TAGS_MASTER_KEY` and `TODO_MASTER_KEY`, 32-byte
      base64 — `openssl rand -base64 32`, run **once per service** (two distinct values;
      independent custody per MAP M3). Compose fails fast without them
      (`compose.yaml:63`, `compose.yaml:101`). Validated by `loadMasterKeyFromEnv`
      (`packages/crypto/src/keys.ts:110-128`): standard base64 decoding to exactly 32 bytes.
      Verify unquoted in `.env` with `printf '%s' "$K" | base64 -d | wc -c` → `32`.
- [ ] **Do NOT regenerate `NOTE_MASTER_KEY`** — it already exists on a running stack, and
      changing it makes every existing encrypted note undecryptable. These keys are
      write-once; losing one loses that service's data.
- [ ] Record current image tags/digests: `docker compose images`.
- [ ] Baseline the running stack's health so you know what "healthy" looked like before.

## 2. Stop and back up (destructive-window protection)

```bash
docker compose down            # NO -v : -v also removes redis-app-data (sessions)
mkdir -p backup/$(date +%Y%m%d-%H%M%S)
cp apps/note-service/data/life.db  backup/<stamp>/life.db
cp apps/idp/data/*                 backup/<stamp>/   2>/dev/null || true
# tags.db / todo.db will not exist yet on a master-based stack — that is expected
```

- [ ] Backups are **readable** (`sqlite3 life.db 'PRAGMA integrity_check;'` → `ok`).
      Do not continue otherwise. Rollback depends entirely on this.

## 3. Migration

Dry-run first and read the counts — `import-tags` is idempotent, and a zero-tag stack
means a no-op.

```bash
NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> \
NOTE_DB_PATH=$PWD/apps/note-service/data/life.db \
TAGS_DB_PATH=$PWD/apps/tags-service/data/tags.db \
  npm run import-tags -w @life/tags-service -- --dry-run
```

- [ ] Counts look right. Then re-run the same command **without** `--dry-run`.
- [ ] Script's own backups + `PRAGMA quick_check` reported ok
      (`apps/tags-service/scripts/import-tags.ts:11-24`).

## 4. Boot

- [ ] IdP only if not already seeded on this stack:
      `NODE_ENV=production SEED_USERNAME=… SEED_PASSWORD=… npm run seed -w apps/idp`
- [ ] `docker compose up -d --build`
- [ ] Ordering is enforced by `depends_on` + healthchecks: Redis → services → `app`.
      Do **not** deploy the frontend before its backends are healthy.

## 5. Verify

- [ ] `docker compose ps` — every healthcheck green (`/health/ready`; ports 3001/3004/3005
      services, 3003 idp, 3002 app).
- [ ] Logs clean for `tags-service`, `todo-service`, `app` — no boot/`synchronize` errors.
- [ ] Log in, then: **tags still render in `/notes`** (the migration's success signal).
- [ ] `/todos` list → status pills → tag/list filters → search → create → edit → save.
- [ ] `/notes` create → open → save → trash → restore → permanent delete.
- [ ] Per-route PWA: `/notes` and `/todos` each load their own manifest
      (`/manifest-notes.json`, `/manifest-todos.json`) and a signed-out visit returns to
      **that same route**.
- [ ] Frontend still builds the UI from the shared blocks — no visual drift in the shells.

## 6. Rollback

- [ ] Images: `docker compose up -d` with the previous recorded tags.
- [ ] Data: restore `life.db` (and `tags.db` if the migration ran) from Step 2 — **old code
      cannot read the new arrangement**, so code and data roll back together
      (`docs/specs/SPEC-tags-extraction.md:102-103`).
- [ ] There is no down-migration. A restore overwrites current state.

## Hard lines

No one else does these: stopping the stack, running `import-tags`, restoring backups,
`docker compose up` against production, and any merge to `master`. This document is the
checklist; it is not authority to run it.

## Known doc debt

`docs/intent/docker-deploy.md:35-45` still claims a two-service stack and "zero
migration". It predates the ecosystem chapter and is misleading for this deploy — treat
this runbook as authoritative instead.
