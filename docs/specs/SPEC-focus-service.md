# Spec: `focus-service` — `apps/focus-service`

Module id: `focus-service` (from the capability map `MAP-pomodoro-focus-stats.md`, whose
§0 surfaces the run's assumptions before this spec's content; module-specific ones are
recorded in §9). Serves the confirmed intent in `docs/intent/pomodoro-focus-stats.md`.

## 1. Objective

For the repository owner (375 px iPhone SE first, desktop second): every focus block —
completed or stopped early — becomes one durable session row, and the daily focus goal
keeps its own history, so any past day can be measured against the goal it was measured
against while today re-measures against the current goal. The timer records effort and
discards it today; this service is what stops the discard.

Acceptance criteria:

- A focus block that completes or is stopped early is persisted as one row and survives
  service restart and page reload.
- An aborted block records its actual elapsed minutes (paused time excluded, floored to
  whole minutes); anything under one minute is discarded — no row is written, and the
  service refuses one if sent.
- Only focus blocks are recorded; a break is never a session row.
- Setting the goal for a date writes a dated goal row and never rewrites past rows; a day
  resolves to the latest row with `validFrom <= day`. Hence a past day keeps its goal
  after a later change, and changing the goal for today re-measures today.
- All reads and writes are owner-isolated by the IdP `sub`; one owner never sees
  another's rows.
- The service never derives a day from its own clock: every date is client-passed.

Wire contract (locked here, consumed by `pomodoro-stats`; the module owns it):

- `POST /api/sessions` — body `{ date: 'YYYY-MM-DD', minutes: number }` → 201, the row
  `{ id, ownerSub, date, minutes, createdAt }`. `minutes` is an integer in `1..180`
  (`MINUTES_RANGE`); anything else is a 4xx.
- `GET /api/sessions?from=<date>&to=<date>` → the owner's raw rows in range, oldest
  first. No aggregation, no bucketing, no pagination — the app keeps filtering,
  bucketing and the scroll window.
- `PUT /api/goal` — body `{ date: 'YYYY-MM-DD', minutes: number }` → upserts the goal row
  for exactly that `validFrom` date (a second set for the same date replaces it; rows
  for other dates are never touched).
- `GET /api/goal` → all the owner's goal rows `{ validFrom, minutes }` (tiny: at most one
  row per changed day). The app resolves day → goal with the rule above.
- `GET /health/ready` — the sibling services' health probe.

Day→goal resolution rule (locked here): for a day `D`, the goal is the `minutes` of the
goal row with the greatest `validFrom <= D`; no such row means "no goal set".

## 2. Tech Stack

- TypeScript 5.7.x, Node 22, NestJS + TypeORM + PostgreSQL — the `apps/meal-service`
  shape (app.module / app.factory / service-config / feature folders).
- `@life/cache` (`ReadThroughCache`) + Redis: the generic read-through with per-owner
  generation counters, composed exactly like `meal-service`'s `meal-cache.ts`.
- `@life/service-kit` kernel; IdP access token (single `life-api` audience,
  `SPEC-service-kernel` transport contract); the BFF calls via `lib/client.ts`
  `callService` and the browser never sees a token.
- `@life/db` backup tooling covers the new tables like every other service's.
- New third-party dependencies: none beyond what the sibling services already use.

## 3. Commands

Repo profile commands only. The repo profile has no build knob, so this spec adds no
build step.

```bash
# typecheck — run in the touched workspace
npm run typecheck -w @life/focus-service
# typecheck — all workspaces (before handing the PR over)
npm run typecheck

# unit tests — one file, from the owning workspace; max 2 runs per command
npm run test:unit -w @life/focus-service -- test/goal-resolution.test.ts

# e2e — Playwright is the app surface's tool and belongs to SPEC-pomodoro-stats;
# this service's "e2e" is its *.e2e-spec.ts suites, run the same way:
npm run test:unit -w @life/focus-service -- test/sessions.e2e-spec.ts
```

## 4. Project Structure

```
apps/focus-service/src/app.module.ts        Nest wiring (the meal-service shape)
apps/focus-service/src/app.factory.ts       app factory
apps/focus-service/src/main.ts              PORT/HOST entry
apps/focus-service/src/service-config.ts    env/config
apps/focus-service/src/sessions/            session entity, DTOs, controller, service
apps/focus-service/src/goals/               goal entity, DTOs, controller, service
apps/focus-service/src/cache/focus-cache.ts the @life/cache adapter (namespace `focus`)
apps/focus-service/test/                   *.test.ts + *.e2e-spec.ts (meal-service pattern)
apps/app/lib/focus-api.ts                  BFF client + wire types (owned by this spec)
docs/specs/SPEC-focus-service.md           this spec
```

## 5. Code Style

Dense intent comments on every non-obvious decision, the sibling services' voice; the
cache adapter pins only the namespace and inherits all mechanics from `@life/cache`:

```ts
// apps/focus-service/src/cache/focus-cache.ts — adapter over the generic read-through
// cache (`@life/cache`). Generation-counter mechanics, fail-open, TTL and
// rows-as-persisted discipline live in the shared package; this module only pins the
// `focus` namespace. Key shape: `focus:<sub>:v<gen>:<rest>`, counter `focus:gen:<sub>`.
const SERVICE = 'focus';

export function generationKey(sub: string): string {
  return `${SERVICE}:gen:${sub}`;
}

export class FocusCache extends ReadThroughCache {
  constructor(client: CacheClient | null) {
    super({ service: SERVICE, client });
  }
}
```

```ts
// apps/focus-service/src/goals/goals.service.ts — the locked resolution rule.
/** A day resolves to the latest goal row with `validFrom <= day`; none means unset. */
export function resolveGoal(rows: GoalRow[], day: string): number | null {
  const applicable = rows.filter((r) => r.validFrom <= day);
  return applicable.length ? applicable[applicable.length - 1].minutes : null;
}
```

## 6. Testing Strategy

- Framework: jest (`ts-jest`), the sibling services' layout. Unit suites
  `apps/focus-service/test/*.test.ts`; service suites `*.e2e-spec.ts` in the
  `meal-service` pattern (fake Redis + test DB, like `entries.e2e-spec.ts`).
- Unit: minutes flooring + the sub-minute discard rule; goal resolution (latest
  `validFrom <= day`, past-day stability, same-date replace).
- Service e2e: owner isolation, row durability across a cache flush, the write path
  bumping the owner's generation, fail-open on cache errors, 4xx on malformed rows.
- Cache suite asserts cached values are rows-as-persisted (the serialized entity rows,
  never a DTO), keys are `focus:<sub>:v<gen>:…`, and content filters/pagination never
  enter keys. The ciphertext tripwire pattern of `notes-cache.e2e-spec.ts` is the
  template; here the assertion is "rows as persisted", per `## Cache Rules`.
- Levels: unit + service e2e here; Playwright e2e belongs to `pomodoro-stats`.
- Budget: max 2 runs per command.

## Cache Rules

(AGENTS.md Contract 2, Rule 4 — mandatory section.)

- **Cached shapes:** serialized entity rows exactly as persisted — session rows
  (`id`, `ownerSub`, `date`, `minutes`, `createdAt`) and goal rows (`validFrom`,
  `minutes`) — never DTOs, never presentation.
- **Deviation, recorded:** `focus-service` is non-content (numbers and timestamps only,
  no free text), so the at-rest ciphertext contract (`enc.v1.` envelopes via
  `@life/crypto`) does not apply and no `enc.v1.` assertion is required. The
  rows-as-persisted discipline above still holds absolutely.
- **Key composition:** `focus:<sub>:v<gen>:sessions:<from>:<to>` and
  `focus:<sub>:v<gen>:goal`, with the counter at `focus:gen:<sub>` — the `meal-service`
  composition. The date range is the fetch scope (like `entries:<date>`), not a request
  filter; no filters or pagination exist to leak into keys.
- **Invalidation:** the per-owner generation counter bumps on every successful write
  (session create, goal upsert); TTL (`CACHE_TTL_SECONDS` from `@life/cache`) is the
  backstop.
- **Failure mode:** fail-open — any cache error degrades to the direct loader and the
  cache may never cause unavailability. Reads go through the read-through loader only;
  write flows go BE → DB → generation bump. The DB is the source of truth.

## 7. Boundaries

**Always do**

- Owner-isolate every query by the IdP `sub`; accept only client-passed dates.
- Store rows-as-persisted in the cache; bump the owner's generation on every successful
  write; fail-open on any cache error.
- Keep `apps/app/lib/focus-api.ts` wire types identical to the service DTOs (one
  contract, this spec owns it).
- Run `npm run typecheck -w @life/focus-service`, the touched suites, and the Contract 2
  mechanical checks (`grep -rln "getThrough" apps/focus-service/src`, this `## Cache
  Rules` section present) at every review touching the service.

**Ask first**

- Any new third-party dependency.
- The exact PORT (hard line; `3107` proposed) and any port or compose wiring change.
- Schema changes beyond this service's own two tables; any production data migration
  (plan + document a checklist — the human runs it).
- Branch/PR mechanics beyond the agreed flow: every branch is cut from `origin/dev` and
  every PR targets `dev`; never merged without the user's say-so.

**Never do**

- Derive a day from the service's own clock.
- Record breaks; expose any update or delete of session rows; rewrite past goal rows.
- Return or accept rows across owners.
- Fork `notes-cache.ts`, bypass the read-through loader for reads, store DTOs in the
  cache, or put filters/pagination into cache keys.
- Add a build command or a build step (the repo profile declares none).
- Widen the test commands or exceed 2 runs per command.
- Merge the PR or push to `main`/`dev`.

## 8. Success Criteria

1. `npm run typecheck -w @life/focus-service` is green, and `npm run typecheck` is green
   before handover.
2. `npm run test:unit -w @life/focus-service -- <file>` is green for every suite in
   `apps/focus-service/test/`, each within 2 runs.
3. Durability: a `POST /api/sessions` row is still returned by `GET /api/sessions` after
   a cache flush and a service restart.
4. Minutes rule: a 95-second aborted block stores `minutes: 1`; a 40-second aborted
   block stores nothing, and `POST /api/sessions { minutes: 0 }` is a 4xx.
5. Goal semantics: after `PUT /api/goal {date: D}` then `PUT /api/goal {date: D+1}`,
   day `D` still resolves to its original minutes while `D+1` resolves to the new ones;
   a second `PUT` for the same date replaces exactly that row.
6. Owner isolation: with two owner tokens, neither `GET` surface ever includes the
   other's rows (e2e-spec).
7. Cache assertions green: keys `focus:<sub>:v<gen>:…`, generation bump on every write,
   fail-open exercised on cache errors, cached values byte-equal to the persisted rows.
8. `grep -rln "getThrough" apps/focus-service/src` is non-empty and no repository access
   exists outside the cache's loader.
9. No session update/delete endpoint exists anywhere in the controllers.

## 9. Assumptions

1. The session row is `id, ownerSub, date, minutes, createdAt` — no start/end timestamps
   and no completed/aborted flag; nothing in the outcome reads them. (`ponytail:` add
   `startedAt` when a surface needs within-day ordering.)
2. Whole-minute flooring happens at record time (client seam); the service validates an
   integer `1..180` and rejects everything else.
3. Goal rows are one per date; a second set for the same date replaces it (map §0.6).
4. Non-content rows, so the ciphertext at-rest contract does not apply (map §0.8,
   recorded under `## Cache Rules`).
5. New loopback port `3107` proposed (map §0.9) — ask-first, hard line.
6. Wire shapes follow the meal-service conventions (`YYYY-MM-DD` date strings, ISO
   `createdAt`).
7. Only `apps/app` consumes the service, through the BFF (`callService`); the browser
   never calls it directly.

## 10. Open Questions

1. Tab-close / navigation away mid-focus is not recorded (map §0.10). If it should count
   as an aborted block, it needs a persistence seam that respects the out-of-scope
   timer-mechanics exclusion — a separate decision, not smuggled in.
2. Session retention is unbounded; there is deliberately no deletion path (out of scope).
   A retention policy would be a new ask.
3. Whether the goal's `minutes` ceiling should be service-configurable instead of the
   shared `MINUTES_RANGE` (1–180) — assumed shared today.
