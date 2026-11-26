# Local runbook — meal photo → real foods (meal-ingredients chapter)

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

Scope: run the **meal photo → real foods** feature on a laptop with `npm run dev:build`,
then test its three identity-resolution paths by hand. This is the development
companion to `docs/runbooks/deploy-meal-nutrition.md` (production). Read it with
`docs/specs/SPEC-photo-identity.md` (the resolution contract) and
`docs/specs/SPEC-usda-source.md` (the USDA boundary).

Everything here is **local**. No production deploy, no `compose.yaml`, no Redis.

## 0. What is new

1. **A photo now resolves each item's identity, not its numbers.** The model names a
   food; the backend supplies the nutrient vector — from your catalog, or from USDA
   (`SPEC-photo-identity.md`). No nutrient value transcribes through the model.
2. **A new USDA client** (`apps/meal-service/src/usda/usda.client.ts`) — one HTTP
   boundary, keyed by `USDA_API_KEY`.
3. **A grams-based editor** (`SPEC-meal-capture-grams.md`): `Entry.quantity` stays
   servings; the `Grams` box is a view over `quantity × servingGrams`.
4. **A log-time catalog write**: a `Food` row is created only when you save the log,
   never at estimate time.

```bash
grep -n "USDA_API_KEY" apps/meal-service/src/usda/usda.client.ts   # the fail-closed key read
grep -n "USDA_API_KEY\|USDA_API_BASE" .env.development.example    # the block you will fill
```

## 1. Prerequisites

- [ ] Working tree on the feature ref (`git log -1 --oneline`).
- [ ] `openssl` on `PATH` (used to generate the master keys).
- [ ] Ports **3100–3108** free. `dev:build` binds app `3100`, note-service `3101`,
      idp `3102`, tags-service `3104`, todo-service `3105`, meal-service `3106`,
      focus-service `3107`, feedback-service `3108`.
- [ ] No Redis to install. `REDIS_URL` is **unset in dev by design**; meal-service then
      takes the direct-DB path (`deploy-meal-nutrition.md` §2). Do not start Redis for
      local work.

## 2. Env surface (names only — never real values)

`.env.development` is loaded by `node --env-file-if-exists=.env.development` on the
`dev:build` process. Every name below rides to the child services.

| Var | Needed by | Meaning / safe example |
|---|---|---|
| `NOTE_MASTER_KEY` | note-service | 32-byte base64 at-rest key. Generate once: `openssl rand -base64 32` |
| `TAGS_MASTER_KEY` | tags-service | same — see the commented block in `.env.development.example` |
| `TODO_MASTER_KEY` | todo-service | same |
| `MEAL_MASTER_KEY` | meal-service | same. **meal-service refuses to boot without it.** |
| `USDA_API_KEY` | meal-service | USDA FoodData Central key — the provisioning gap this runbook closes (§2 below) |
| `USDA_API_BASE` | meal-service | optional; defaults to `https://api.nal.usda.gov/fdc`. Set only for a proxy. |
| `GEMINI_API_KEY` | meal-service | Google AI Studio key; the photo estimate needs all three `GEMINI_*` |
| `GEMINI_MODEL` | meal-service | model id, from env only |
| `GEMINI_API_BASE` | meal-service | Gemini API base, from env only |
| `MEAL_API_URL` | app BFF | `http://127.0.0.1:3106` (already in the example file) |

**Master keys fail closed with no dev fallback.** `packages/crypto/src/keys.ts`
`loadMasterKeyFromEnv` throws `CryptoError('missing master key: environment variable
<NAME> is not set')` when a key is unset, and each service uses it at boot.
Generate one key per service and paste the base64:

```bash
for name in NOTE_MASTER_KEY TAGS_MASTER_KEY TODO_MASTER_KEY MEAL_MASTER_KEY; do
  printf '%s=%s\n' "$name" "$(openssl rand -base64 32)"
done
```

Verify a key decodes to 32 bytes before pasting:

```bash
printf '%s' "$K" | base64 -d | wc -c      # → 32
```

**Losing a master key makes every existing encrypted row undecryptable.** Generate,
paste, then **back the keys up outside the repo**. Never regenerate one on a database
that already holds rows.

**On the USDA key**: it rides the **query string**, so any URL you log or paste is
a leaked key. Get one from <https://fdc.nal.usda.gov/api-key>. `DEMO_KEY` is the
documented public exploratory value, not a secret — fine for one smoke test, but
**rate-limited to 30 requests/hour and 50/day per IP**.

## 3. First run

`.env.development` does not exist in a clean checkout — `--env-file-if-exists` tolerates
its absence silently, and services then fail on missing config with confusing errors.
Create it first:

```bash
cp .env.development.example .env.development
```

1. Uncomment the `*_MASTER_KEY` lines and paste those keys from §2 — the
   `todo-ecosystem` block holds `TAGS_`/`TODO_`/`MEAL_`, and `NOTE_MASTER_KEY` sits in
   the data-privacy block.
2. Uncomment `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE` in the meal-service
   photo block and fill them. **All three are required** before the estimate turns on.
   Unset ⇒ the estimate answers its explicit failure shape and the service still boots
   (the client is built on the first request, not at boot).
3. Uncomment `USDA_API_KEY` (and `USDA_API_BASE` only for a proxy) in the same block.

Then start the stack:

```bash
npm run dev:build
```

`dev:build` runs `dev:seed && build && concurrently …`: it **builds every workspace
first**, then runs each service's `start` against its `dist`. That is why it is slower to
start than sibling `npm run dev` (which runs watchers with **no** build) — and faster to
respond once up, because nothing is watching. Use `dev:build` to test built behavior;
use `dev` while editing code.

`dev:seed` (`SEED_LOAD_DEV_ENV=1 npm run seed -w apps/idp`) seeds the dev IdP user
automatically as part of `dev:build` — no second terminal, no manual seed.

Log in at <http://localhost:3100> with the seeded dev user (see
`.env.development.example`'s IdP block for the default pair), then open `/meals`.
(`dev:build` sets `WEB_PORT=3100 APP_DEV_SKIP_ACCESS_GATE=1` so login works in dev.)

**No migrations.** None exist repo-wide; tables are created at boot by schema sync.
This feature added **no** schema change, so a database from the previous chapter keeps
working — you do not need to delete `data/*.db`.

## 4. Smoke test

- [ ] `curl -fsS http://127.0.0.1:3106/health/ready` → 200.
- [ ] `/meals` opens on the day view.
- [ ] The camera FAB **Log meal from photo** opens `/meals/entry/new?door=photo`
      (the editor titled **Log meal**).
- [ ] Send a kitchen photo through **Choose a photo**. While it runs,
      **Reading the photo…** shows; then either items appear (§5) or the failure
      banner does (§6).

## 5. Testing each resolution path

Open `/meals/entry/new?door=photo` (the **Log meal** editor). Add an optional hint via
the **Photo hint (optional)** box — a hint steers, it is never a correction. Send the
photo with **Choose a photo**.

Each item the estimate returns shows a **Dish** field, a **Grams** field, the four
headline fields (`Calories`, `Fat`, `Carbs`, `Protein`), and an
**All nutrients (27)** button. There are three ways an item resolves
(`SPEC-photo-identity.md` § Resolution):

### Path 1 — catalog food (zero USDA calls)

The model matched a food you already have. The item shows **your catalog's stored
numbers**, and USDA is not called.

Test it:

1. Log a food once — photo or **Add item** — and **Save meal** so the catalog gains the
   row (see "log-time write" below).
2. Re-photo the same food.
3. The item shows the numbers you saved, and the button reads
   **All nutrients (27) · 23 estimated** (a full known set).

To prove *zero* USDA calls, unset `USDA_API_KEY` and restart: a catalog hit still
resolves (path 1 does not touch USDA), while a non-catalog food's fetch fails to path 3.

### Path 2 — USDA fetch (no catalog match)

The model returned an `fdcId`. The item shows **USDA's numbers**, in the same
**All nutrients (27) · 23 estimated** shape as path 1.

Test it:

1. Keep `USDA_API_KEY` set.
2. Photo a common whole ingredient you have **not** logged before.
3. The item fills with numbers (at least the headline is non-empty).

### Path 3 — neither (the absent-data affordance)

No catalog food, no usable USDA id. The item is still logged, but with **no numbers**:
every field renders the em dash **—** (`UNKNOWN` in `@life/nutrition`), the
stored meaning of "no nutrient data". The **All nutrients (27)** button has **no**
`· … estimated` suffix.

Test it:

1. Set `USDA_API_KEY` to a deliberately invalid value (or unset it) and restart.
2. Photo a food not in your catalog.
3. The item shows **—** in every field; nothing is fabricated as `0`.

### What makes an item "estimated"

`isEstimated` is **client-derived** from the item's `known` coverage
(`editor.tsx:106`); it is **not** a wire field. Do not look for it in a network
response. A full 27-field estimate shows the `· 23 estimated` suffix; a path-3 or manual
item keeps an empty `known` set and shows the em dash instead.

### The `Grams` field and the log-time write

**Grams** is a view over `quantity × servingGrams`, not a stored field. Type a weight and
the numbers rescale; `quantity` stays servings underneath. A referenced catalog food
reports its **own** `servingGrams` (never forced to 100).

The catalog gains a `Food` **only when you tap Save meal** — never at estimate time. So
path 1 above needs a prior save; photographing a food you never logged takes path 2 or 3.
On save, a `foodId: null` item is matched by normalized name; only a miss creates the
food, at `servingGrams: 100` with the confirmed vector un-scaled back to that base.

## 6. Failure modes and what they mean

| What you see | Cause |
|---|---|
| Banner **Couldn't read that photo. Enter the meal by hand — nothing was guessed.** | The model returned no usable identity JSON. The editor opens one empty item, every field unknown. |
| Item fields all show **—** | Path 3 (or a manual item). Not a crash — the food is logged with no numbers. |
| `USDA is not configured: USDA_API_KEY must be set` | The key is unset and a USDA fetch was attempted (path 2). The estimate still returns; that item falls to path 3. |
| `Gemini is not configured: GEMINI_API_KEY, GEMINI_MODEL and GEMINI_API_BASE must all be set` | One of the three `GEMINI_*` vars is missing. The service booted; the estimate route answers its failure shape. |
| `missing master key: environment variable MEAL_MASTER_KEY is not set` at boot | `MEAL_MASTER_KEY` blank/unset. meal-service refuses to boot — fix §2. |
| A `rate-limited` USDA item | The key (or `DEMO_KEY`) hit its hourly/daily limit. A `429` is never retried. |

## 7. Secrets handling

- The doc, `.env.example`, and `.env.development.example` hold **names and generation
  commands only**, never values. Keys **never go in git**.
- `USDA_API_KEY` travels in the **query string** (`ApiKeyAuth: in: query`), unlike
  Gemini's header key. Any logged URL is a leaked key; data.gov deactivates keys it
  finds published. The USDA client logs nothing — keep it that way.
- `DEMO_KEY` is a documented public exploratory value, not a secret — but it is
  rate-limited (30/hour, 50/day per IP). Get a real key for anything past a first look.
- Back up every master key outside the repo. Losing one makes its service's existing
  encrypted rows undecryptable.

## What you should see

- [ ] `npm run dev:build` builds every workspace, seeds the dev user, and brings up eight
      processes; `curl -fsS http://127.0.0.1:3106/health/ready` returns 200.
- [ ] `/meals` day view renders; the **Log meal from photo** FAB opens the **Log meal**
      editor at `/meals/entry/new?door=photo`.
- [ ] **Choose a photo** with the three `GEMINI_*` vars set returns items with names and
      grams; **Reading the photo…** appears while it runs.
- [ ] A path-1 or path-2 item shows numbers and **All nutrients (27) · 23 estimated**.
- [ ] A path-3 item shows **—** in every field and the plain **All nutrients (27)**
      button.
- [ ] **Save meal** writes the day's entries and, for a new name, one catalog food.

## Related

- Production: `docs/runbooks/deploy-meal-nutrition.md`
- Specs: `docs/specs/SPEC-photo-identity.md`, `docs/specs/SPEC-usda-source.md`,
  `docs/specs/SPEC-meal-capture-grams.md`
- Research: `docs/research/usda-fdc-api.md`
