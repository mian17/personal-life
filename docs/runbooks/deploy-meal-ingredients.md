# Production runbook addendum — meal photo → real foods (meal-ingredients chapter)

Scope: the **meal-ingredients** chapter — photo identity resolution on top of the
meal-nutrition stack: each estimate item becomes a catalog food at 100 g with a
USDA-verified 27-nutrient vector, logged by grams. Backend, env, and backup; no
compose change. The `apps/app` label join rides along with the same `app` image
rebuild.

Read this **with** `docs/runbooks/production-deploy.md` (the baseline stack) and
`docs/runbooks/deploy-meal-nutrition.md` (the meal-service service, its ten env
names, boot/health/rollback) — both remain authoritative for their areas. Read it
with `docs/specs/SPEC-photo-identity.md` (the resolution contract) and
`docs/specs/SPEC-usda-source.md` (the USDA boundary).

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it. Do **not** merge to `master` unless asked explicitly.

## 0. What is new

1. **`meal-service` photo identity resolution** — the estimate loop names foods
   (Gemini) and the backend supplies each item's vector: from the owner's `food`
   catalog when the estimate resolved `foodId`, else from USDA FoodData Central
   (`apps/meal-service/src/usda/`). Nothing transcribes a nutrient through the model.
2. **A log-time catalog write** — `resolveFoodId` in
   `apps/app/app/(meals)/meals/entry/[id]/actions.ts` creates the `Food` row only
   when the log is saved, never at estimate time.
3. **Correct row labels** — the day view and the saved-meal detail page render
   `restoredFoodName(entry.foodId, catalog)`; a UUID is never a label.
4. **No compose change.** The `meal-service` block, `redis-meal`, `meal.db` volume,
   and healthcheck are all the previous chapter's; this chapter adds no new service,
   volume, or port. The one new env pair (§2) needs no compose edit — the block
   already carries `env_file: .env`, so a name set in `.env` reaches the container
   without being repeated under `environment:`. Confirm it arrived rather than
   assuming it:

```bash
docker compose exec meal-service sh -c 'printenv USDA_API_KEY >/dev/null && echo set || echo UNSET'
```

## 1. Migration / schema verdict — none

No migration files exist (repo-wide). Tables are created at boot by the service's
own schema sync (`apps/meal-service/src/app.module.ts:21-26`) — this chapter adds
no new entity, so booting the new build adds no table. **Never regenerate
`MEAL_MASTER_KEY`**; it stays write-once from the meal-nutrition deploy.

## 2. Env surface (new pair only — §2 of deploy-meal-nutrition.md covers the rest)

`.env` values never touch a doc — only the **names** are here.

| Var | Meaning | Safe example / default |
|---|---|---|
| `USDA_API_KEY` | FoodData Central key — the photo estimate's USDA-side resolution. The client is built on the first lookup (fail-closed then), never at boot | from https://fdc.nal.usda.gov/api-key. `DEMO_KEY` is the public exploratory value (30/hour, 50/day — usable to prove the path, not to serve logs). Unset ⇒ that item falls to the absent vector and the service still boots |
| `USDA_API_BASE` | Optional USDA base override | defaults to `https://api.nal.usda.gov/fdc`; only a proxy sets it |

**Leak discipline:** the key rides in the USDA query string — the module header
names it (`apps/meal-service/src/usda/usda.client.ts:29`) — so a logged URL is a
leaked key, and data.gov deactivates keys it finds published. The client therefore
writes no request URL to a log — and neither should you: never paste a failing
USDA URL into chat, an issue, or this doc.

## 3. Pre-flight

- [ ] Working tree clean on the deploy ref: `git status --short && git log -1 --oneline`.
- [ ] `.env` has the pair from §2 set — at minimum `USDA_API_KEY`; `USDA_API_BASE`
      stays unset unless a proxy fronts FDC.
- [ ] `OIDC_AUDIENCE_MAP` contains `https://meal-service=life-api` (already at
      `.env.example:43`; a stale `.env` 401s every meal request).
- [ ] Record the images you are about to replace (rollback target):
      `docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life`
- [ ] Baseline health: `docker compose ps` — `meal-service`, `app`, `idp` healthy.
- [ ] **Back up `meal.db` by hand.** The repo tool does **not** cover it:
      `packages/db/src/paths.ts` lists `life | tags | todo | idp` only, so
      `npm run db:backup -w @life/db` silently skips the meal database — the one
      holding the whole food catalog and every logged entry. `meal.db` is a
      bind-mounted file, not a volume, so it is also not covered by any volume
      backup. With the service stopped (never `docker compose down`):

      ```bash
      docker compose stop meal-service
      cp apps/meal-service/data/meal.db apps/meal-service/data/meal.db.bak
      sqlite3 apps/meal-service/data/meal.db.bak 'PRAGMA integrity_check;'   # → ok
      ```

- [ ] If `apps/meal-service/data/meal.db` does not exist yet, this is the
      service's first boot on this stack: there is nothing to back up, and §1's
      verdict applies unchanged.

## 4. Deploy

```bash
git -C /path/to/personal-life fetch
git -C /path/to/personal-life checkout <ref>
cd /path/to/personal-life
docker compose up -d --build meal-service app
```

- [ ] `docker compose ps` — `meal-service` healthy (unchanged `/health/ready`),
      `redis-meal` up, `app` healthy.
- [ ] `docker compose logs meal-service --since 2m` — boot with `MEAL_MASTER_KEY`
      accepted, no JWKS/audience error, no unhandled exception. No USDA line at
      boot is **expected**: the client builds on the first lookup, not at boot.
- [ ] `docker compose logs app --since 2m` — no `/meals` BFF error.

## 5. Verify

- [ ] `curl -fsS http://127.0.0.1:3106/health/ready` → 200 (unchanged).
- [ ] **The key reached the container** (it is the difference between real numbers
      and blank rows): `docker compose exec meal-service sh -c 'printenv
      USDA_API_KEY >/dev/null && echo set || echo UNSET'` → `set`. This prints a
      verdict, never the value.
- [ ] After one photo estimate, the unconfigured warning must be **absent**:
      `docker compose logs meal-service --since 5m | grep -c "USDA lookup skipped"`
      → `0`. Any hit means every photo item falls to the absent vector: names and
      grams, no numbers — the exact symptom this chapter removes.
- [ ] On the app: `/meals` day list shows **food names, never a UUID**
      (the `restoredFoodName` join). A stale cached shell still showing an id is
      a client asset, not data — hard-reload before concluding otherwise.
- [ ] **Photo estimate:** a kitchen photo resolves each item to a named food with
      a filled vector; an item that gets no USDA vector still logs its name + grams.
- [ ] **Grams log:** edit a row's grams, save, and confirm the entry's nutrients
      scale with the change and the catalog food still reads the base per-100 g
      vector.
- [ ] **No duplicate food from a re-log:** log the same food name a second time
      (a new entry, same spelling) and confirm the catalog still holds **one**
      `Food` for it — `resolveFoodId` matches by normalized key before it creates
      (`GET /api/foods`). Two rows for one name means the key path regressed.
- [ ] Cache sanity unchanged (`redis-meal` fail-open, §5 of
      deploy-meal-nutrition.md).

## 6. Local smoke (not production)

For a same-machine rehearsal of §4–5 without touching the server: `npm run dev:build`
(see `docs/runbooks/dev-meal-ingredients.md`) exercises exactly the
estimate → catalog-create → grams-log path this chapter ships, against
`USDA_API_KEY` **without** `REDIS_URL`.

## 7. Rollback

- [ ] **Code:** check out the previous ref and rebuild:
      `git checkout <previous-ref>; docker compose up -d --build meal-service app`
      (same as §7 of deploy-meal-nutrition.md).
- [ ] **Data:** `meal.db` from this chapter stays readable by the previous ref —
      no new entity was added — so a code-only rollback needs no restore. If a
      restore is needed anyway, it comes from §3's in-place copy; the repo
      `db:restore` tool does not know `meal.db`.
- [ ] **Never** rotate or regenerate `MEAL_MASTER_KEY`; **never**
      `docker compose down` — both are hard lines (see below).

## Hard lines

No one else does these: `docker compose down`, stopping a production service,
backing up or restoring `meal.db`, `docker compose up` against production,
generating or rotating `MEAL_MASTER_KEY`, and any merge to `master`. A key's
**value** never enters a doc, a log, or a chat — names only.

## Related

- Baseline: `docs/runbooks/production-deploy.md`
- Meal service + its env table: `docs/runbooks/deploy-meal-nutrition.md` (its
  §2 table now carries the full USDA pair — this file's §2 is the excerpt)
- Local rehearsal: `docs/runbooks/dev-meal-ingredients.md`
- Contract: `docs/specs/SPEC-photo-identity.md`, `docs/specs/SPEC-usda-source.md`,
  `docs/specs/SPEC-meal-service.md`, `docs/specs/SPEC-meal-capture-grams.md`
- Lessons: `docs/lessons/0011-cache-contract-and-stale-maps.md`,
  `docs/lessons/0012-cross-chapter-invariants.md`
