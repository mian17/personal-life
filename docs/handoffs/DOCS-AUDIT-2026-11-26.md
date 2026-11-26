# Docs audit — the 40 false claims behind PR #195

Written 2026-11-26. This is the evidence record behind
`docs: correct the stale operational claims in README, AGENTS and the runbooks`
(#195, `49d24e3`): what was audited, how, what the 40 rows said, and what happened
to each. It adds no policy and changes no claim.

## What was audited

Nineteen in-scope files at `origin/dev` `ffa7515`: `README.md`, `AGENTS.md`,
`docs/ops/backmerge.md`, and the sixteen files under `docs/runbooks/`. The audit
was read-only — `git status --porcelain` was empty before and after it.

Method: every present-tense claim a reader acts on today was checked against the
tree with `ls`, `grep`, `git log`, `git tag`, `git show`, `node -e` manifest
inspection, and one `gh run list --limit 5`. Line numbers cited inside the docs
were graded as claims too, because a wrong line number sends a reader to the wrong
code. Historical narratives — a past run's step number, a past deploy's effect —
were not graded.

Verdicts over 118 rows: **40 STALE**, 75 VERIFIED, and three the audit's rules
excluded (answered below). The 40 are verbatim from the audit report: one row per
claim, the primary line first, repeats of the same claim inside one file listed in
the same row.

## The 40 rows that were false

| path:line | claim (quoted, <=120 chars) | verdict | truth today + evidence |
|---|---|---|---|
| `README.md:5-11` | "`apps/note-service` — NestJS + TypeORM/SQLite REST API (loopback only)." … "`packages/shared` — shared DTO/types." | STALE | The block is the repo inventory and is incomplete: `ls apps/` = app, feedback-service, focus-service, idp, meal-service, note-service, pomodoro, tags-service, todo-service (9); `ls packages/` = app-kit, cache, crypto, db, mcp-gateway, nutrition, ops, service-kit, shared, ui (10). Missing: `meal-service`, `focus-service`, `pomodoro`, and 9 packages. |
| `README.md:40-41` | "`npm run start` is no longer used. Four services run on the internal `life` network" | STALE | 18 compose services, 8 of them app services: `compose.yaml` keys note-service:2, tags-service:48, todo-service:86, feedback-service:130, meal-service:177, focus-service:227, idp:275, app:333 (+10 infra). The same sentence then lists six (note, tags, todo, feedback, idp, app). |
| `README.md:114-115` (also `:122`) | "npm run dev        # note-service :3101 + app :3100 + idp :3102 + tags :3104" … "(all six)" | STALE | `package.json` `dev` runs `concurrently` over note-service, tags-service, todo-service, meal-service, feedback-service, focus-service, app, idp = 8. Missing meal `PORT=3106` and focus `PORT=3107`. Line 122 repeats "starts all six services". |
| `README.md:185-186` | "`redis-note`, `redis-tags` and `redis-todo` are **read-through caches** over their own databases (LRU, unpersisted)" | STALE | Three more unpersisted caches exist: `redis-feedback` (compose.yaml:576), `redis-meal` (compose.yaml:606), `redis-focus` (compose.yaml:634). `redis-app`/`redis-idp` are named in the same paragraph, so the enumeration is presented as exhaustive. |
| `README.md:247-248` | "Kept: `AGENTS.md`, `docs/runbooks/`, `docs/lessons/`, `docs/research/`, `docs/reports/`." | STALE | `ls -d docs/*/` = design-systems, handoffs, lessons, ops, releases, research, runbooks — no `docs/reports/` (`.gitignore` line "docs/reports/"), and `docs/ops/`, `docs/releases/`, `docs/handoffs/`, `docs/design-systems/` are unlisted. |
| `AGENTS.md:93` | "npm run release -- <version>        # tags, pushes the tag, creates the release" | STALE | The script now bumps `package.json`, cuts `chore/release-v<x>` (`scripts/release.sh:555`), opens a PR (`:298`), waits for a second CI gate on the bump commit (`:327-328` `BUMP_CI_WAIT_ATTEMPTS=40`/`SECONDS=30`), merges with `--merge` (`:387`), and only then tags. The comment describes the pre-PR script. |
| `AGENTS.md:96-98` | "The script refuses unless the tree is clean, HEAD is `origin/dev` … and CI is green on that exact SHA." | STALE | Every listed refusal still exists, but the set is no longer complete: a second gate refuses when any workflow on the bump commit's own SHA is not `completed`/`success` (`release.sh:339,361,374`; `docs/runbooks/release.md:32-42`). The sentence is the section's authoritative refusal list. |
| `docs/ops/backmerge.md:16` | "The back-merge commit is content-neutral, so `sonarqube.yml` detects it by tree comparison and skips the scan" | STALE | That workflow is deleted: `git log --diff-filter=D -- .github/workflows/` → `65525ce`/`fbd80f1` "ci: retire the self-hosted runner job…" removed `.github/workflows/sonarqube.yml`; `ls .github/workflows/` = backmerge.yml, compose-boot.yml, secrets.yml, tests.yml. No workflow skips anything for a back-merge — there is no scan to skip. |
| `:155` | "`FOCUS_MASTER_KEY` \| `compose.yaml:242` \| idem" | STALE | `grep -n ':?' compose.yaml` → `FOCUS_MASTER_KEY` is at **247**. |
| `:156` | "`FEEDBACK_DB_PASSWORD` \| `compose.yaml:521` \| Postgres role password" | STALE | At **537**: `POSTGRES_PASSWORD: ${FEEDBACK_DB_PASSWORD:?…}`. |
| `:157` | "`FEEDBACK_RABBITMQ_PASSWORD` \| `compose.yaml:543` \| broker `feedback` user password" | STALE | At **559**: `RABBITMQ_DEFAULT_PASS: ${FEEDBACK_RABBITMQ_PASSWORD:?…}`. |
| `:164` | "(`packages/crypto/src/keys.ts:110-128`) fails closed on anything else" | STALE | `wc -l packages/crypto/src/keys.ts` = **96**; the range runs past EOF. |
| `:188` | "`OWNER_LOGIN` (app access gate, `apps/app/middleware.ts:42`)" | STALE | `apps/app/middleware.ts` does not exist; the gate module is `apps/app/proxy.ts`, where `:42` is `ownerLogin: process.env.OWNER_LOGIN,`. |
| `:193` | "the compose default at `compose.yaml:291` now carries note/tags/todo/meal" | STALE | `OIDC_AUDIENCE_MAP` default is at **305**; compose.yaml:291 is `OIDC_APP_CLIENT_SECRET`. |
| `:195` | "form (a **comma**-separated list) is at `.env.example:43`." | STALE | `OIDC_AUDIENCE_MAP=` is `.env.example:52`; line 43 is `OIDC_PRODUCER_PRODUCER_A_REDIRECT_URIS=…`. |
| `:200` | "The VAPID trio is in `.env.example:79-81`, commented out" | STALE | `grep -n VAPID .env.example` → 107, 112, 113, 114 (`# TODO_VAPID_PUBLIC_KEY=` at 112). |
| `:215` | "`main` lags it (141 commits when this was written) and still builds Node 22 images" | STALE | Both lines build Node 24: `apps/app/Dockerfile:4,32` `FROM node:24-bookworm-slim`, and `git show origin/main:apps/app/Dockerfile` gives the same two lines. |
| `:44-48` | "TypeORM `synchronize: true` in all seven data services: `…todo-service/src/app.module.ts:24`, `…meal-service…:24`, `…focus-service…:23`" | STALE | Three of the seven refs are wrong: note:16 ✓, tags:15 ✓, feedback:23 ✓, idp:18 ✓, but todo `synchronize: true` is at **41**, meal at **53**, focus at **27**. |
| `:54` | "`npm run import-tags -w @life/tags-service` (`apps/tags-service/package.json:13`)" | STALE | `import-tags` is on line **14** of `apps/tags-service/package.json`. |
| `:55` | "`npm run cleanup-tags -w @life/tags-service` (`apps/tags-service/package.json:14`)" | STALE | `cleanup-tags` is on line **15**. |
| `:56` | "`npm run backfill-content-updated-at -w @life/note-service` (`apps/note-service/package.json:11`)" | STALE | On line **12** of `apps/note-service/package.json`. |
| `:60` | "`scripts/backfill-owner.ts` (`apps/note-service/package.json:9-12`)" | STALE | The five scripts span **9-13**: `start`=9, `backfill-owner`=10, `backfill-encrypt`=11, `backfill-content-updated-at`=12, `rotate-master-key`=13. |
| `:11` (also `:63`, `:110`, `:203`) | "`apps/*/data/*.db` (the four live databases), `backup/` (pinned snapshots) and" | STALE | Six SQLite databases today: compose bind mounts at 28/66/110/207/255/313 → life, tags, todo, meal, focus, idp. `:110` heads a backup step and `:203` a rollback step that would both miss `focus.db`. |
| `:69` (also `:143`) | "five existing Redis instances are untouched — no block changes, no data moves." | STALE | Eight Redis services: redis-app:397, redis-idp:412, redis-note:440, redis-tags:467, redis-todo:495, redis-feedback:576, redis-meal:606, redis-focus:634. `:143` says "the six Redis instances all up". |
| `:96` | "Must contain `https://meal-service=life-api` (already at `.env.example:43`)." | STALE | `OIDC_AUDIENCE_MAP=` is `.env.example:52` and does contain the meal entry; line 43 is an `OIDC_PRODUCER_*` URI list. |
| `:1,7,17,19,20,32,37,304` | "Deploy ref: **`master` after merging `feat/app-feedback`** (39 commits)." | STALE | No `master` branch exists: `git branch -a` → dev, main, pi/*; `origin/HEAD -> origin/main`. Every instruction to merge into `master` names a branch that is gone. |
| `:11` | "`apps/*/data/*.db` (the five live SQLite databases), `backup/` (pinned snapshots) and" | STALE | Six today (`focus.db` added with focus-service; compose.yaml:255). |
| `:61` | "(`apps/meal-service/src/keys/keys.service.ts`). Verify a key is 32 bytes before pasting:" | STALE | `ls apps/meal-service/src/keys/` → No such file or directory. The master-key contract lives in `apps/meal-service/src/service-config.ts:10` (`MASTER_KEY_ENV = 'MEAL_MASTER_KEY'`). |
| `:106` | "npm run dev                           # repo root: all six processes incl. meal-service" | STALE | Root `dev` starts 8 workspaces (note, tags, todo, meal, feedback, focus, app, idp) per `package.json`. |
| `:16,131` | "authority to run it. Do **not** merge to `master` unless asked explicitly." | STALE | No `master` branch (`git branch -a`); the release line is `main`. |
| `:47` | "own schema sync (`apps/meal-service/src/app.module.ts:21-26`) — this chapter adds" | STALE | `synchronize: true` in that file is at **53**; lines 21-26 are entity/module imports. |
| `:61` | "names it (`apps/meal-service/src/usda/usda.client.ts:29`) — so a logged URL is a" | STALE | The query-string/`ApiKeyAuth` argument is at `usda.client.ts:25-28`; line 29 is `export type UsdaFailureReason`. |
| `:20,169` | "authority to run it. Do **not** merge to `master` unless asked explicitly." | STALE | No `master` branch (`git branch -a`). |
| `:17,145,152` | "authority to run it. Do **not** merge to `master` unless asked explicitly." | STALE | No `master` branch (`git branch -a` → dev, main, pi/*); `:145` also speaks of "the `master` fast-forward". |
| `:17,153` | "authority to run it. Do **not** merge to `master` unless asked explicitly — building the" | STALE | No `master` branch (`git branch -a`); the release line is `main`. |
| `:17,185` | "authority to run it. Do **not** merge to `master` unless you ask for that explicitly —" | STALE | No `master` branch (`git branch -a`); the release line is `main`. |
| `:101` | "All five databases snapshot — `life.db`, `tags.db`, `todo.db`, `idp.db`, `meal.db` — and every" | STALE | Six SQLite databases today; `focus.db` arrives with the focus-service bind mount (compose.yaml:255) and is covered by the root `db:backup`. |
| `:12` | "it. Do **not** merge to `master` unless asked explicitly." | STALE | No `master` branch (`git branch -a`); release line is `main`. |
| `:36-37` | "Ports **3100–3106** free. `dev:build` binds app `3100`, note-service `3101`, idp `3102`, tags `3104`, todo `3105`, meal `3106`." | STALE | `dev:build` also starts focus-service `PORT=3107` and feedback-service `PORT=3108` (root `package.json`), so the required free range is 3100–3108 and the enumeration is short two services. |
| `:61-64` | "returns early when `NODE_ENV === 'development'` and sets principal `dev-user` without reading the token, so a bogus token and an absent one both answer `200`" | STALE | `packages/service-kit/src/auth/auth.guard.ts:67` is `if (token === undefined && process.env.NODE_ENV === 'development')`, and `:75` `return this.verifyJwt(req, token)`. A presented (bogus) token is verified and rejected, so only an absent token reaches `dev-user`; `:64`'s "The comment claims 'for localhost'" no longer matches the header at `:32-36`. |

## What happened to them

All 40 were applied at `49d24e3`, each re-checked against the tree at `ffa7515`
before editing: 5 rows in `README.md`, 2 in `AGENTS.md`, 1 in
`docs/ops/backmerge.md`, 14 in `production-deploy.md`, and 1 to 3 each in eleven
other runbooks. The edits are corrections in place — no section added, no file
rewritten — and the reference check below is their mechanical half: it walked
every backticked path and every backticked `npm run` in those 19 files at the same
commit and found nothing pointing at a renamed or deleted file.

## The three rows the audit could not grade

The audit's permitted calls did not cover repository settings or host state, so
these were left ungraded rather than guessed at. All three are answered now.

| path | claim, as the audit left it | what it is today |
|---|---|---|
| `docs/runbooks/public-repo.md:24-31` | "The runner is still registered, at repository level … `# total_count 1 — fedora-sonarqube, online, labels: self-hosted, Linux, X64, sonarqube`" | **Unregistered.** `gh api repos/mian17/personal-life/actions/runners` → `{"total_count":0,"runners":[]}`, and `-q .total_count` → `0`. The unit went with it: `systemctl --user list-unit-files 'github-runner*'` → 0 unit files. Corrected on 2026-11-26, keeping the verification command and the removal path as the procedure if one ever reappears. |
| `docs/runbooks/production-deploy.md:84` | "**No crontab is installed.** `backup/cron.log` does not exist, so neither §8 backup line has ever fired here." | **Both lines are installed and firing.** `crontab -l` carries the two §8 lines verbatim; `backup/cron.log` (61 KB) holds their output, last entry a `db:backup:pg [routine]` run at `2026-11-25T21-00-04-920Z`. Corrected in §0 and §8. |
| `docs/runbooks/production-deploy.md:66` | "the table currently holds 0 rows" — the live `food` table, and the §9 rollback note that repeats it as "no user data is at risk" | **14 rows.** `select unit, count(*) from food group by unit` → `g\|13`, `ml\|1`; `pragma table_info(food)` ends with `9\|unit\|TEXT\|1\|'g'\|0`, so the schema change landed and one row carries a non-default unit. Corrected in §0 and §9. |

## Where this record lives

`docs/reports/` is gitignored per-run scratch — `.gitignore` carries the pattern
`docs/reports/` — so the audit report is not committable, and a rewrite
justified by it would rest on a file no reader can open. That is why this record
is under `docs/handoffs/`, which is tracked, and why the table is reproduced here
rather than linked to.

## Reference check

A separate read-only pass asserted every backticked path and every backticked
`npm run` in the same 19 files against `origin/dev`. Its final line, verbatim:

```text
files=19 refs_checked=309 paths=271 scripts=38 missing=39
```

Scripts: **0 misses** — 17 distinct names across 38 invocations, every one
resolving in the root or a workspace manifest. Path staleness: **0** — 209 paths
resolve exactly, 23 resolve as contextual suffixes, and all 39 non-resolving
tokens were judged one by one: 16 are per-run spec scratch under `docs/specs/`
(gitignored by design), 11 are an untracked reference checkout and its `pictures/`
sibling next to the repo, 7 are not filesystem paths at all (`next/link`,
`tools/list`, `Asia/Ho_Chi_Minh`, …), 4 are paths the docs describe as
intentionally deleted, and 1 is a runtime file the e2e harness writes. `missing=39`
is that residue, not staleness; a fixture with a genuinely missing path exits 1
with `missing>0`, so the check can fail.
