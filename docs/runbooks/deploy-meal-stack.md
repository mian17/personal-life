# Deploy runbook — meal stack (deploy `master`)

Deploy ref: **`master` after merging `feat/meal-ingredients`** (`77eb2c4`).

Runs entirely in the **primary checkout** — `/home/night/WebstormProjects/personal-life` —
because that is where the live stack lives: `.env` (production secrets),
`apps/*/data/*.db` (the four live databases), `backup/` (pinned snapshots) and
`compose.yaml`. No worktree, no second checkout, **no data file is moved**.

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it.

## 0. Prerequisite — merge the branch into `master`

The branch is 100 commits ahead of `master` (`0260d4b`), has no remote, and is
currently held by the worktree at `.worktrees/meal-ingredients`. Merging to `master`
is **your** call and needs your explicit go-ahead; nothing in this runbook merges.

```bash
cd /home/night/WebstormProjects/personal-life
git log -1 --oneline                       # record this: it is your rollback ref
git worktree remove .worktrees/meal-ingredients   # frees the branch (tree is clean)
git merge --no-ff feat/meal-ingredients
git branch -d feat/meal-ingredients
npm install                                # new workspaces (@life/nutrition,
                                           # apps/meal-service) + changed lockfile
```

- [ ] The pre-merge `master` commit is recorded — §8 rolls back to it.
- [ ] Merge clean; `git status --short` shows only the untracked
      `docs/reference-repo/` and `pictures/` (leave both alone).
- [ ] `.gitignore` on `master` now carries `.worktrees/` (the branch brought it, so
      the primary checkout's uncommitted copy of that same edit is satisfied).
- [ ] `npm install` completed at the repo root.

Until this merge lands, do not deploy: `master` has no `meal-service`, no
`packages/nutrition`, and no `meal` support in `packages/db`.

## 1. What this deploy changes on the host

Two chapters arrive together, because neither has ever run here:

1. **Meal service** (`deploy-meal-nutrition.md`) — `meal-service` on `:3106` and its
   `redis-meal` cache. New containers; no existing block changes except `app`, which
   gains `depends_on: meal-service` and `MEAL_API_URL: http://meal-service:3106`.
2. **Ingredients** (`deploy-meal-ingredients.md`) — photo→foods identity resolution
   (Gemini names a food; the catalog or USDA supplies the vector), the grams editor,
   the log-time catalog write, and catalog-resolved row labels.

Facts that decide the steps below:

- `apps/meal-service/data/` does **not** exist yet — this is an **introduction**,
  not an upgrade. There is no `meal.db` to back up and no stale `meal-service`
  container to remove.
- **No migration files exist repo-wide.** Schema is created at boot by the service's
  own TypeORM sync (`synchronize: true` in
  `apps/meal-service/src/app.module.ts`), which creates `meal.db` and its seven
  tables (`user_keys`, `target`, `food`, `serving`, `entry`, `saved_meal`,
  `saved_meal_item`). The four existing databases are not touched — each service
  syncs only its own file.
- The `import-tags` data migration in `production-deploy.md` §3 belongs to an earlier
  lane and **already ran on this host** — the `backup/2026-10-01T11-38-*-pinned`
  snapshots bracket it. Do not re-run it.
- The other backends (`note-service`, `tags-service`, `todo-service`, `idp`) and the
  five existing Redis instances are untouched — no block changes, no data moves. Only
  `app` is rebuilt and reconfigured, and only `meal-service` and `redis-meal` are new.

## 2. Env (names only)

`.env` values never touch a doc — only the **names** are here. Edit the primary
checkout's `.env` directly (compose reads it via `env_file: .env`).

| Var | Required? | Notes |
|---|---|---|
| `MEAL_MASTER_KEY` | **yes — hard fail-fast** | 32-byte base64 content key, per-service custody. Compose refuses to start without it (`${MEAL_MASTER_KEY:?…}`) and the service also refuses to boot. Generate it now, once: `openssl rand -base64 32`. Verify before pasting: `printf '%s' "$K" \| base64 -d \| wc -c` → `32`. **Write-once from here on** — back it up outside the repo with the other master keys, and never regenerate it once `meal.db` holds data. |
| `USDA_API_KEY` | yes in practice | FoodData Central key, from https://fdc.nal.usda.gov/api-key. Reaches the container through the block's `env_file: .env` — no compose edit needed. Unset ⇒ every USDA-side photo item falls to the absent vector: name and grams, **no numbers**, while everything else works. |
| `USDA_API_BASE` | no | Leave unset unless a proxy fronts FDC (defaults to `https://api.nal.usda.gov/fdc`). |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE` | yes — all three, for photo | The model client is built on the first photo lookup and fails closed at construction: any one missing ⇒ every photo estimate answers its failure shape, while manual entry keeps working. Reaches the container through `env_file: .env`. Owned in detail by `deploy-meal-nutrition.md` §2. |
| `OIDC_AUDIENCE_MAP` | verify | Must contain `https://meal-service=life-api` (already at `.env.example:43`). A `.env` carried from an older deploy 401s every meal request without it. |

- [ ] `MEAL_MASTER_KEY` generated and verified as 32 decoded bytes **before** pasting.
- [ ] `USDA_API_KEY` present in `.env`.
- [ ] The Gemini trio (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE`) all present —
      missing any one turns every photo estimate into `service-unavailable`.
- [ ] `OIDC_AUDIENCE_MAP` contains the meal-service entry.
- [ ] Leak discipline: `USDA_API_KEY` rides the **query string** (unlike Gemini's
      header key), so a logged URL is a leaked key and data.gov deactivates published
      keys. Never paste a failing USDA URL into chat, an issue, or a doc.

## 3. Pre-flight

```bash
cd /home/night/WebstormProjects/personal-life
```

- [ ] Ref pinned and clean: `git log -1 --oneline` → the merge commit;
      `git status --short` → only `docs/reference-repo/` and `pictures/` untracked.
- [ ] Record the images you are about to replace (rollback reference):
      `docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life`
- [ ] Baseline health of the running stack: `docker compose ps` — the services you
      expect healthy before the change.
- [ ] Create the meal data directory explicitly, so Docker does not create it
      root-owned: `mkdir -p apps/meal-service/data`.
- [ ] Port `3106` free on `127.0.0.1`.

## 4. Back up — the four existing databases, pinned

A deliberate pre-deploy snapshot, so it is pinned (never auto-pruned). Run it from the
repo root with **no path overrides**: the tool's defaults are repo-anchored
(`packages/db/src/paths.ts`), so at this checkout they already point at the live files.

`--only` is required **for this first deploy**: `meal.db` does not exist yet, and the
default set of five would fail closed (D10) and abort the whole run before writing
anything.

```bash
npm run db:backup -w @life/db -- --pin --only life,tags,todo,idp
```

- [ ] Four `quick_check=ok` lines and a new `backup/<stamp>-pinned/` directory with a
      `PINNED` marker. Rollback of the existing chapters depends entirely on this.
- [ ] Do **not** continue otherwise.
- [ ] From the next deploy on, `meal.db` exists and the bare form covers all five:
      `npm run db:backup -w @life/db -- --pin`.

## 5. Deploy

```bash
docker compose up -d --build app meal-service
```

Only `app` and `meal-service` are named: both changed (`app` gained `MEAL_API_URL` +
`depends_on: meal-service`, `meal-service` is new), and naming them keeps the other
five containers untouched. `redis-meal` comes up with them — `meal-service` depends on
it being healthy. `redis-app` (the session store, AOF + named volume) is never touched,
so **existing logins survive** — nothing forces a re-login.

- [ ] `docker compose ps` — `app`, `idp`, `note-service`, `tags-service`,
      `todo-service`, `meal-service` (new), and the six Redis instances all up;
      healthchecks green on every service that declares one (`/health/ready` on
      3001/3004/3005 note/tags/todo, 3106 meal, 3003 idp).
- [ ] `docker compose logs meal-service --since 2m` — `MEAL_MASTER_KEY` accepted, no
      JWKS/audience error, no unhandled exception. **No USDA line at boot is
      expected**: that client is built on the first lookup, never at boot.
- [ ] `docker compose logs app --since 2m` — no `/meals` BFF error.
- [ ] `apps/meal-service/data/meal.db` now exists.

If `up` fails on `MEAL_MASTER_KEY is required`, §2 was not applied — fix `.env` and
re-run `docker compose up -d --build app meal-service`.

## 6. Verify

New surface:

- [ ] `curl -fsS http://127.0.0.1:3106/health/ready` → 200.
- [ ] Auth: a request to `meal-service` with no token, or a foreign-audience token,
      is **401** (JWT-only, `aud: life-api`).
- [ ] **The key reached the container** — this is the difference between real numbers
      and blank rows:
      `docker compose exec meal-service sh -c 'printenv USDA_API_KEY >/dev/null && echo set || echo UNSET'`
      → `set`. It prints a verdict, never the value.
- [ ] After one photo estimate, the unconfigured warning must be **absent**:
      `docker compose logs meal-service --since 5m | grep -c "USDA lookup skipped"`
      → `0`. Any hit means every USDA-side item falls to the absent vector.

Existing surface (prove the deploy did not regress what already worked):

- [ ] `/notes` create → open → save → trash → restore.
- [ ] `/todos` list → filters → create → edit → save.
- [ ] Tags still render in `/notes` (the earlier lane's data survived).
- [ ] Signed-out visits still return to their own route.

Meals surface:

- [ ] `/meals` opens; an entry can be created and reads back; the unit table renders.
- [ ] **Photo estimate:** a kitchen photo resolves each item to a named food with a
      filled vector; an item that gets no USDA vector still logs its name + grams.
- [ ] **Row labels:** the day list and the saved-meal page show food names, never a
      UUID. Hard-reload before concluding against a stale cached shell.
- [ ] **Grams log:** edit a row's grams, save, and confirm the entry's nutrients scale
      with the change while the catalog food still reads its base per-100 g vector.
- [ ] **No duplicate food from a re-log:** log the same food name a second time and
      confirm the catalog still holds **one** `Food` for it.
- [ ] Cache sanity: a second identical list read is served by `redis-meal`, and the
      service still works with `redis-meal` stopped (fail-open).

## 7. Steady state

- [ ] The daily cron line is unchanged and now covers five databases —
      `npm run db:backup -w @life/db`. Confirm the installed line's checkout path is
      the primary checkout.
- [ ] Future deploys: §3 → §6 from the repo root, with no `--only` needed on the
      backup. A meal-only change still takes a pinned `--only meal` snapshot first.
- [ ] Keep §4's pinned snapshot until a routine backup lands on top of this stack.

## 8. Rollback

- [ ] **Code:** `git checkout <the pre-merge master commit recorded in §0>` then
      `docker compose up -d --build meal-service app`. The four existing databases
      were never converted, and `meal.db` only gained tables, so older code reads
      current data.
- [ ] **Data:** the stack must be stopped first (`docker compose down` — never
      `-v`), then
      `npm run db:restore -w @life/db -- --from backup/<§4-stamp>-pinned`.
      The tool's `3002`/`3003` probe fail-closes on a running stack, and it takes a
      pinned pre-restore snapshot before overwriting anything. There is no
      down-migration; a restore overwrites current state.
- [ ] **`meal.db`:** it did not exist before this deploy. Rolling back the code leaves
      the file in place — do not delete it.
- [ ] **Never** rotate or regenerate `MEAL_MASTER_KEY`; **never** `docker compose
      down -v`; **never** delete `apps/*/data/`, `backup/`, or `.env`.

## Hard lines

No one else does these: merging to `master`, stopping the stack, `db:backup`,
`db:restore`, `docker compose up` against production, generating a master key. A
key's **value** never enters a doc, a log, or a chat — names only.

## Related (kept, not replaced)

- `docs/runbooks/production-deploy.md` — baseline stack, `import-tags` (already run),
  its own verify/rollback detail
- `docs/runbooks/deploy-meal-nutrition.md` — the service's env names, boot/health
  detail, chapter-level rollback
- `docs/runbooks/deploy-meal-ingredients.md` — the ingredients addendum
- `docs/runbooks/dev-meal-ingredients.md` — the laptop rehearsal of the same path
- Contract: `docs/specs/SPEC-photo-identity.md`, `docs/specs/SPEC-usda-source.md`,
  `docs/specs/SPEC-meal-service.md`, `docs/specs/SPEC-meal-capture-grams.md`,
  `docs/specs/SPEC-db-backup-restore.md`
