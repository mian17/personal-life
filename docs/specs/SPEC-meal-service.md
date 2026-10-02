# Spec: meal-service

Module id: `meal-service` (see `MAP-meal-nutrition.md`). Depends on: `nutrition-model`.

## Objective

The backend of the feature: owner-scoped foods, diary entries, and saved meals; the
photo → Gemini suggestion pipeline; the read-through cache; and content at rest.

It is the third service in the repo, so it must **not fork** what the first two established —
it consumes `@life/cache` and `@life/crypto` the way `note-service` and `todo-service` do, and
copies no cache or crypto code (Contract 2, Rule 4).

**User:** me, through the `apps/app` BFF.
**Success:** a photo becomes a corrected, savable diary entry with a defensible nutrient vector;
the day sums on read; nothing readable ever rests in DB, Redis, logs, or backups.

## Tech Stack

- NestJS 11, TypeORM 0.3, `better-sqlite3` via `@life/db`, `@life/cache` (Redis
  read-through), `@life/crypto` (`enc.v1.` envelope), `@life/shared` (DTOs), `@life/nutrition`.
- JWT verification via `jose` against the IdP's JWKS, exactly as `note-service/src/auth/`.
- Gemini via HTTPS `fetch` to the Generative Language API. **No SDK dependency** — one
  endpoint, one JSON shape; an SDK for that is not warranted. Model id and API base come from
  env, never hardcoded.
- Port `:3106` (next free in the dev registry), `MEAL_API_URL`, `MEAL_MASTER_KEY`, and an
  `OIDC_AUDIENCE_MAP` entry `https://meal-service=life-api`.

## Commands

```
typecheck:  npm run typecheck -w apps/meal-service
test:unit:  npm run test:unit -w apps/meal-service -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

`max-test-runs: 2` (project profile).

## Project Structure

Follows `apps/note-service` file-for-file:

```
apps/meal-service/
  src/
    main.ts / app.factory.ts / app.module.ts
    auth/          # copies the guard/verifier/principal shape (no invention)
    health/
    keys/          # DEK custody; MEAL_MASTER_KEY
    foods/         # the food catalog (per-food nutrient record + servings)
      food.entity.ts serving.entity.ts dto/ foods.controller.ts foods.service.ts foods.module.ts
      foods-cache.ts
    entries/       # diary entries: food × quantity × meal × date
      entry.entity.ts dto/ entries.controller.ts entries.service.ts entries.module.ts
      entries-cache.ts
    saved-meals/   # frozen snapshots
      saved-meal.entity.ts saved-meal-item.entity.ts dto/ …-cache.ts
    photo/         # Gemini pipeline
      gemini.client.ts photo.controller.ts photo.service.ts photo.module.ts
      dto/estimate-photo.dto.ts
    targets/       # SPEC-target-onboarding.md owns this folder's contract
  test/
    entries.e2e-spec.ts entries-cache.e2e-spec.ts ownership.e2e-spec.ts photo.e2e-spec.ts
    gemini.client.test.ts fake-gemini.ts setup-env.ts jwt-harness.ts
```

## Code Style

Entity conventions are non-negotiable — copied from `note.entity.ts`:

```ts
@Entity('entry')
@Index('IDX_entry_owner_sub', ['ownerSub'])
export class Entry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text', nullable: true }) ownerSub: string | null;
  @Column({ type: 'integer', default: 0 }) version: number;
  @Column({ type: 'datetime', nullable: true }) deletedAt: Date | null;
  @CreateDateColumn({ type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime' }) updatedAt: Date;
}
```

Other rules:

- `ownerSub` always comes from `@Principal()`, **never** from a request body.
- Content fields are `enc.v1.` envelopes with a byte-exact AAD:
  `life.v1|<sub>|meal|<field>|<id>`. The entity id is service-generated (`randomUUID`) *before*
  insert so the AAD is reconstructible.
- Writes: BE → DB → `bumpGeneration(sub)`. Reads: `cache.getThrough(sub, key, loader)` only.
- Cache stores serialized rows **as persisted** (ciphertext), never a decrypted DTO. Refuse to
  cache a plaintext legacy row (`isCiphertextXRow` guard, mirroring `isCiphertextNoteRow`).

## Cache Rules

Required by Contract 2, Rule 4.

**Isolation (lesson 0011):** meal-service gets its **own Redis instance** (`redis-meal`),
wired with the repo's single per-service `REDIS_URL` (injected by `compose.yaml` in production;
**unset in dev/e2e**, which intentionally runs Redis-free — `MAP-redis.md` and `.env.example`:
"No Redis keys belong here"). Pointing at `redis-note`/`redis-todo` with service-prefixed keys
does **not** satisfy this contract — `docs/intent/redis-shared-state.md` decision 3 is one
instance per service, not a shared instance with disjoint namespaces. `compose.yaml` and
`MAP-redis.md` are updated in the same change; a capability map that never names the module is
how the previous violation shipped (lesson 0011).

Key shape follows `@life/cache` and Contract 2 Rule 3 — `<service>:<sub>:v<gen>:<rest>`, with
per-owner isolation carried by the `<sub>` segment:

| Shape cached | Key | Contents |
|---|---|---|
| Food rows, list/all | `meal:<sub>:v<gen>:food:<rest>` | rows as persisted, ciphertext |
| Entry rows for a date | `meal:<sub>:v<gen>:entries:<date>` | rows as persisted, ciphertext |
| Saved-meal rows | `meal:<sub>:v<gen>:saved:<rest>` | rows as persisted, ciphertext |
| Generation counter | `meal:gen:<sub>` | integer, bumped per successful write |

- **Filters and pagination never enter the key.** A date is part of the *fetch identity* (one
  entry set per day per owner), so it is in the key; a meal-group filter is applied
  **post-hit, in memory, after decrypt**.
- Content matching (search over food names) runs **post-decrypt, in memory** — never `LIKE`
  over encrypted columns.
- **Invalidation:** bump the owner's generation on every successful write (create, update,
  delete, save-meal, target change). TTL is a backstop only.
- **Failure mode:** fail open. Redis down ⇒ `getThrough` runs the loader directly; a cache error
  must never cause unavailability and must never write plaintext into the fallback path.
- **Photo estimates are never cached.** A Gemini result is per-request, transient, and
  unconfirmed; only a *confirmed* entry is persisted.

## Nutrient semantics

**One owner for unit and `%DV` formatting: `@life/nutrition`.** Neither this service nor the UI
re-implements the unit table or derives a display string locally; both consume the model's
formatter (lesson 0016). The service stores and sums `NutrientVector`s; it never formats them.

**One owner for "which day a date string means": the client.** This service receives a resolved
`YYYY-MM-DD` from the BFF and never derives a day from its own process clock (lesson 0019 —
production is UTC, the user is UTC+7, so a host-clock day is wrong for the first seven hours of
every local day). `new Date()` is not permitted in any request path here.

- An entry stores the **scaled, confirmed nutrient vector** — a snapshot — plus the food and
  quantity it came from. It does not recompute from the food on read. Editing a food later must
  not rewrite history (same principle as `target-onboarding`).
- Daily totals are `sum()` over the day's entries (`@life/nutrition`), computed on read.
- Every food's per-serving nutrients are stored as a complete `NutrientVector` from the model;
  missing data is `0` with no "unknown" state in the stored vector. Whether the *user* was
  warned that a value was estimated is UI state, not storage.

## Photo → Gemini pipeline

- Endpoint takes an image plus an **optional hint string**. The hint is sent as additional
  input to the model — it is steering, not correction (intent doc).
- The service returns a **suggestion, never an entry**: items with an estimated dish,
  ingredients, portion/size, and a nutrient vector. Nothing is written to the diary until the
  BFF posts a confirmed entry.
- The service must be able to say **"I could not read this."** The response schema has an
  explicit failure shape; the model is instructed not to emit invented numbers. A failure maps
  to an empty suggestion, and the UI opens manual entry.
- The API key is read from env (`GEMINI_API_KEY`) and is **never** sent to the browser and never
  logged. Requests to Gemini are made server-side only.
- Timeout and error handling: a network failure, a non-2xx, or a schema-violating response all
  map to the same "could not read" result — never to a partial or guessed entry.
- Image bytes are not persisted. They exist for the duration of the request only (privacy: a
  photo of my kitchen does not belong in Redis, the DB, or a log).

## Testing Strategy

| Concern | Test level | Why |
|---|---|---|
| Owner isolation on every route | e2e (`ownership.e2e-spec.ts`) | a leak here is the one unacceptable bug |
| Cache stores ciphertext only | e2e (`entries-cache.e2e-spec.ts`) | pattern: `notes-cache.e2e-spec.ts` |
| Day totals additive across entries | unit + e2e | the product's core number |
| Entry snapshot immutability | unit | editing a food must not rewrite history |
| Gemini client: hint passthrough, failure mapping, no key in output | unit (`fake-gemini.ts`) | the risky external boundary |
| Schema validation rejects malformed model output | unit | never store a guessed entry |

No live Gemini call in tests — `fake-gemini.ts` mirrors `test/fake-redis.ts`. One optional
manual smoke check against the real API is documented, not automated.

## Boundaries

- **Always:** owner-scope every query; encrypt content; go through the cache for reads; keep the
  Gemini key server-side; map every failure to an explicit no-guess result; validate DTOs.
- **Ask first:** adding a new entity; changing the cache key shape; changing the Gemini model id
  or provider; adding a dependency.
- **Never:** accept `ownerSub` from a body; cache plaintext or an unconfirmed estimate; log
  image bytes, prompts, or the key; recompute an entry's nutrients from a live food row; run
  `LIKE` over encrypted columns; fork `@life/cache` or `@life/crypto`.

## Success Criteria

1. Every CRUD route is owner-scoped; `ownership.e2e-spec.ts` proves user B cannot read, mutate,
   or delete user A's food, entry, saved meal, or target, and cannot leak via a list or a sum.
2. `entries-cache.e2e-spec.ts` asserts cached values contain `enc.v1.` and no known plaintext,
   and that a write invalidates the day.
3. A day's total equals the sum of its entry vectors; deleting one entry moves the total.
4. A saved meal re-logs its corrected (snapshot) values, not a fresh guess.
5. The photo endpoint returns a suggestion or an explicit failure — never a written entry, and
   never an invented number on failure.
6. Zero typecheck errors; prescribed tests pass; `REDIS_URL` unset still boots and serves
   (direct-DB path).

## Open Questions

- Exact Gemini model id and JSON response schema: verified against official docs at
  implementation time via `source-driven-development`; recorded in the ADR, not guessed here.
- Photo request size limit and accepted MIME types: set from the model's documented limits at
  implementation time.
