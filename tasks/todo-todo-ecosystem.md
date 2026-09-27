# Task Ledger: todo-ecosystem

Plan: `tasks/plan-todo-ecosystem.md` · Map + specs: `docs/specs/MAP-todo-ecosystem.md`
+ `SPEC-{service-kernel,tags-service,tags-extraction,todo-service,todo-ui}.md` ·
Intent: `docs/intent/todo-ecosystem.md`.

Branch: `feature/todo-ecosystem`. Process: the global protocol (`~/.config/opencode/
AGENTS.md`) + this repo's AGENTS.md Project Profile/Contracts. Each task = one
subagent (mandatory template), TDD, tech-lead diff review + commit (Blast Radius +
Contract + Project Contract checks + execution audit). Targeted tests, ≤2 runs per
task (profile `max-test-runs`). Merge to `master` on the user's explicit request only.
Case counts are referenced by spec section, never by number (kills count drift).

## Tasks

- [ ] T1: shared kernel primitives (`@life/cache` + `likeMatch`) — module `service-kernel`
  - Description: Extract the generic read-through cache from `apps/note-service/src/notes/notes-cache.ts`
    into `packages/cache` (`@life/cache`, per SPEC-service-kernel's generic signature:
    `createCache({service, client, ttlSeconds})` → `getThrough(sub, rest, loader, opts)`)
    and the LIKE-parity matcher from `content-match.ts` into `@life/shared`; refactor
    note-service onto both with zero behavior change. (AGENTS.md Contract 2 no-fork rule, MAP P1.)
  - Files: `packages/cache/**` (new), `packages/shared/src/like-match.ts` (new),
    `packages/shared/src/index.ts` (barrel re-export of `likeMatch`),
    `packages/shared/test/like-match.test.ts` (new), `packages/shared/package.json`
    (add jest config + `test:unit` script — shared has neither today),
    `apps/note-service/package.json` (add `@life/cache` dep + jest `moduleNameMapper`
    `"^@life/cache$": "<rootDir>/../../packages/cache/src/index.ts"` — mirrors the
    `@life/crypto`/`@life/shared` source-resolution pattern; `@life/cache`'s `main`
    points at `dist/` like `@life/shared`, jest resolves `src/`),
    `apps/note-service/src/notes/notes-cache.ts`, `apps/note-service/src/notes/content-match.ts`
    (thin re-export shim so call sites/tests keep compiling), root `package.json`
    (workspaces += `packages/cache`), `package-lock.json` (via `npm install` only).
  - Acceptance: `@life/cache` honors the kernel contract (key composition
    `<service>:<sub>:v<gen>:<rest>`, gen-counter, 60s TTL, fail-open, ciphertext-only
    value discipline); ported cache + parity suites green; note-service suites
    unchanged-green. (tsc resolves `@life/*` types from `dist/` — hence the builds below;
    root `npm run build` declares workspaces apps-first, so build packages before apps.)
  - Verify: `npm run build -w @life/shared` && `npm run build -w @life/cache` &&
    `npm run test:unit -w @life/cache` && `npm run test:unit -w @life/shared` &&
    `npm run test:unit -w @life/note-service -- test/notes-cache.e2e-spec.ts` && `npm run typecheck`.
  - Dependencies: none. Size: M.
- [ ] T2: health dialect retrofit — module `service-kernel`
  - Description: Add `/health/live`, `/health/ready`, and the `/health` alias
    (readiness semantics) to note-service (registering the controller in
    `app.module.ts` — it currently declares none); align idp's existing
    `@Controller('health')` to the same trio; switch compose healthchecks to
    `/health/ready`. The `/health` alias is load-bearing: the Playwright harness
    (`apps/app/test/e2e/stack.ts`) polls it and treats `<500` as ready.
  - Files: `apps/note-service/src/health/**` (new), `apps/note-service/src/app.module.ts`
    (+ `apps/note-service/src/app.factory.ts` if registration requires it),
    `apps/note-service/src/auth/auth.guard.ts` +
    `apps/note-service/src/auth/public.decorator.ts` (new — `@Public()` Reflector
    exemption so the health trio is unauthenticated behind the global `AuthGuard`;
    `apps/note-service/test/health.e2e-spec.ts` (new), `apps/idp/src/health/health.controller.ts`
    (**modified** — `apps/idp/test/health.e2e-spec.ts` already exists and pins the
    current body), `apps/idp/package.json` (add `test:unit` alias → `test` **and**
    `typecheck` alias → `tsc -p tsconfig.json --noEmit` — idp has neither, so root
    typecheck currently skips it), `compose.yaml` (healthcheck commands only).
  - Acceptance: live = 200 with DB down (no dependency checks); ready = 503 on DB down
    or missing key custody (DB + key only, never cache); `/health` answers identically
    to `/health/ready` on both services; **the health trio answers unauthenticated
    under every NODE_ENV (explicit `@Public()` exemption test — no 401)**; leak-free
    bodies; compose healthchecks hit `/health/ready`.
  - Verify: `npm run test:unit -w @life/note-service -- test/health.e2e-spec.ts` &&
    `npm run test:unit -w @life/idp` && `npm run typecheck`.
  - Dependencies: none. Size: S.
- [ ] T3: `apps/tags-service` registry — module `tags-service`
  - Description: New service — `GET/POST /api/tags`, `PATCH/DELETE /api/tags/:id`,
    `POST /api/tags/resolve`; own key custody (`TAGS_MASTER_KEY`), `@life/crypto`
    at rest, `@life/cache`, health routes, `src/keys/db.ts` resolver (default
    `apps/tags-service/data/tags.db`). Registers itself in the root workspace.
  - Files: `apps/tags-service/**` (new: package.json with `build`/`typecheck`/
    `test:unit` scripts, entities, `tags.module/controller/service`, `keys/*`
    incl. `db.ts`, `health/*`, tests), root `package.json` (workspaces +=
    `apps/tags-service`), `package-lock.json` (via `npm install` only). NOT included:
    `apps/tags-service/Dockerfile` (T9's), `compose.yaml` (T9's).
  - Acceptance: every case in SPEC-tags-service's Testing Strategy (create-or-get
    case-insensitive, ecosystem rename + 409, delete-detach, owner-scoped resolve,
    ciphertext columns, tamper fail-closed, health); Cache Rules honored
    (`tags:<sub>:v<gen>:all`, ciphertext-only); build produces dist.
  - Verify: `npm run test:unit -w @life/tags-service` &&
    `npm run build -w @life/tags-service` && `npm run typecheck`.
  - Dependencies: T1 (uses `@life/cache`). Size: L.
- [ ] T4: `import-tags` migration script — module `tags-extraction`
  - Description: Id-preserving, idempotent note-DB → tags-DB import (re-encrypt under
    registry DEKs; dual-read input — decrypt `enc.v1.` values, pass legacy plaintext
    through, always re-encrypt; `_legacy_` sentinel), self-verified backup first
    (`VACUUM INTO` + `quick_check` of both DBs, the `backfill-owner` precedent),
    `--dry-run`, batched transactions, poisoned-row abort, and the final schema
    surgery (`note_tag` rebuilt without the FK to `tag`, then `tag` table dropped —
    `PRAGMA foreign_keys=OFF` window). Deploy checklist in the script header.
    Human-run later (hard line).
  - Files: `apps/tags-service/scripts/import-tags.ts`, `apps/tags-service/src/tags/import.ts`,
    `apps/tags-service/test/import-tags.test.ts` (new), `apps/tags-service/package.json`
    (script `import-tags` → `ts-node scripts/import-tags.ts`).
  - Acceptance: every case in SPEC-tags-extraction's migration-owned Testing Strategy
    (import + ids preserved, idempotence, dry-run purity + count parity, `_legacy_`
    round-trip, poisoned-row abort, schema surgery, legacy plaintext input, verified
    backup). The TagRef/round-trip behaviors belong to T5's suite.
  - Verify: `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts` && `npm run typecheck`.
  - Dependencies: T3. Size: M.
- [ ] T5: note-service TagRef conversion — module `tags-extraction`
  - Description: note-service stops owning tag names — `tags: string[]` DTOs → `tagIds: number[]`;
    `note_tag` association only via an explicit `NoteTag` join entity mapped to the
    existing `note_tag` table (no `Tag` entity remains; `tagId` plain integer, no FK —
    registry is external per Approach 2); `GET /api/tags` (existing route) changes
    shape in place to `[{tagId, count}]`; tag filter by id (metadata-only SQL); lazy
    prune of dangling ids; `note:tags` cache shape becomes id+count rows. Everything
    that references the `Tag` entity or old tag shapes is updated here — including
    the ops scripts (whose DataSource registers `Tag`; they run against historical
    schemas via raw SQL and must keep doing so) and every pinned suite.
  - Files: `apps/note-service/src/notes/notes.service.ts`, `note.entity.ts`,
    `tag.entity.ts` (removed, replaced by `note-tag.entity.ts` (new)), `notes.controller.ts`,
    `tags.controller.ts`, `apps/note-service/src/notes/dto/**` (`tags` → `tagIds`),
    `apps/note-service/src/notes/notes.module.ts` + `apps/note-service/src/app.module.ts`
    (entity registration), `packages/shared/src/index.ts` (shared input types:
    `CreateNoteInput.tags` → `tagIds`, `UpdateNoteInput`, `Tag` → `TagRef`),
    `notes-cache.ts` integration, `apps/note-service/scripts/encrypt-backfill.ts` +
    `scripts/rotate-master-key.ts` (DataSource entity list — drop `Tag`, add `NoteTag`;
    raw-SQL behavior against historical schemas unchanged), `apps/note-service/test/tag-refs.test.ts`
    (new), and the pinned suites updated to the TagRef contract: `test/notes.e2e-spec.ts`,
    `test/ownership.e2e-spec.ts`, `test/notes-cache.e2e-spec.ts`,
    `test/crypto-roundtrip.test.ts`, `test/content-match.test.ts`, `test/backfill.test.ts`.
  - Acceptance: note-service holds zero tag names; TagRef attach/detach/filter/
    `[{tagId,count}]` + unknown-id prune + note round-trip with `tagIds`
    (SPEC-tags-extraction "Owned by T5" list); all six pinned suites updated and
    green against the TagRef contract; the two ops scripts still compile and their
    raw-SQL flows are untouched; content filtering unchanged (decrypt-then-match).
  - Verify: `npm run test:unit -w @life/note-service` && `npm run typecheck`.
  - Dependencies: T3. Size: L (single concern: the whole note-service tag surface).
- [ ] T6: `apps/todo-service` — module `todo-service`
  - Description: New service — todos (title, note, done, dueDate) + lists + TagRefs +
    `origin` links; own key custody (`TODO_MASTER_KEY`), `@life/crypto` at rest,
    `@life/cache`, health routes; the SPEC-todo-service endpoints (5 todo + 4 list +
    1 usage — **declare `GET /api/todos/tags` before `GET /api/todos/:id`** so the
    literal path is not shadowed); `src/keys/db.ts` resolver (default
    `apps/todo-service/data/todo.db`). Registers itself in the root workspace.
  - Files: `apps/todo-service/**` (new: package.json with `build`/`typecheck`/
    `test:unit` scripts, entities, todo/list modules+controllers+services, `keys/*`
    incl. `db.ts`, `health/*`, tests), root `package.json` (workspaces +=
    `apps/todo-service`), `package-lock.json` (via `npm install` only). NOT included:
    `apps/todo-service/Dockerfile` (T9's), `compose.yaml` (T9's).
  - Acceptance: every group in SPEC-todo-service's Testing Strategy (envelope
    round-trip, AAD swap fail-closed, LIKE parity empirical, ordering+filters+pagination,
    list detach, TagRef prune + count, cache ciphertext-only for content shapes +
    metadata-only tag usage, health + version/409); build produces dist.
  - Verify: `npm run test:unit -w @life/todo-service` &&
    `npm run build -w @life/todo-service` && `npm run typecheck`.
  - Dependencies: T1 (`@life/cache`, `likeMatch`), T3 (TagRef contract). Size: L.
- [ ] T7: `@life/ui` upstream additions — module `todo-ui`
  - Description: The named primitives, added **upstream** with spec updates before
    apps consume them (AGENTS.md Contract 1 Rule 3): `TagPicker` (attach/detach by id),
    `TagManager` (create/rename/delete), `DueDatePill` (due-date display/grouping).
  - Files: `packages/ui/src/**`, `packages/ui/test/**`, `packages/ui/package.json`
    (add `test:unit` + `typecheck` aliases), `docs/specs/SPEC-ui-*.md`,
    `docs/specs/MAP-ui-primitives.md`, `packages/ui/src/styles/tokens.css` (only if new token).
  - Acceptance: the three primitives covered by `@life/ui` tests; spec + map updated in
    the same change; no raw-HTML/raw-value/token leaks (Contract 1 mechanical checks).
  - Verify: `npm run test:unit -w @life/ui` && `npm run typecheck`.
  - Dependencies: none (can precede T8). Size: M.
- [ ] T8: `apps/app` UI — module `todo-ui`
  - Description: Move `/` → `/notes` (+ redirect), build `/todos` (grouped
    Overdue/Today/Later/No date, done toggle, composer, inline edit, filters), wire the
    shared `TagPicker`/`TagManager` to `tags-service` from both apps, rework the note
    composer to `tagIds`, add the app-side transport config (`TAGS_API_URL`,
    `TODO_API_URL`; the shared-audience token model per the kernel contract means the
    session shape is unchanged), update Playwright navigation to the I5 URLs.
  - Files: `apps/app/app/**` (route move + new `/todos`), `apps/app/lib/**`, `actions.ts`,
    `apps/app/test/**` (incl. `apps/app/test/e2e/**` — navigation URLs only, I5-approved),
    `apps/app/package.json` (`typecheck` alias if missing).
  - Acceptance: `/notes` + `/todos` live, `/` redirects; tags one vocabulary across both
    apps; Contract 1 mechanical checks green; frozen e2e diff = I5 URLs and nothing else.
  - Verify: `npm run test:unit -w @life/app` && `npm run build -w @life/app` && `npm run typecheck`.
  - Dependencies: T5 (note-service TagRef), T6 (todo-service), T7 (primitives). Size: L.
- [ ] T9: wiring + integration pass — module `todo-ui` (close)
  - Description: Create `apps/tags-service/Dockerfile` and `apps/todo-service/Dockerfile`;
    update `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`
    for the new `packages/cache` + new workspace manifests (the data-privacy
    deploy-blocker lesson); compose services for tags/todo (env per the kernel
    transport contract: `TAGS_IDP_JWKS_URL`/`TODO_IDP_JWKS_URL`, `TAGS_SERVICE_AUDIENCE`/
    `TODO_SERVICE_AUDIENCE` (= `life-api`, as `NOTE_SERVICE_AUDIENCE` becomes),
    `REDIS_URL`, `DB_PATH` + `./apps/<svc>/data:/data` volumes); IdP audience map →
    `life-api` + `apps/idp/test/**` fixture updates; `.env.development.example`
    documented placeholders + untracked dev keys (`TAGS_MASTER_KEY`, `TODO_MASTER_KEY`);
    full integration pass.
  - Files: `compose.yaml`, `.env.development.example`, untracked `.env.development`,
    `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`,
    `apps/tags-service/Dockerfile` (new), `apps/todo-service/Dockerfile` (new),
    `apps/idp/src/**` + `apps/idp/test/**` (audience map + fixtures only),
    `apps/app/test/e2e/**` harness infra (`stack.ts`/`config.ts`/service wiring —
    bring tags/todo up in the Playwright stack; frozen *assertions* untouched, T8
    owns only the I5 navigation URLs), root `package.json` (dev script gains
    tags/todo), `.env.example` (its `OIDC_AUDIENCE_MAP` line → `life-api`),
    `README.md` (auth section). T3/T6 must NOT create Dockerfiles or touch compose.
  - Acceptance: dev stack (`npm run dev`) and the Playwright harness both bring up
    tags/todo so `/notes` and `/todos` render names; `.env.example` + README agree
    with the `life-api` model; all three services authenticate the app's single
    `life-api` token; `npm run typecheck` + workspace builds green; all
    targeted suites green in one pass (incl. idp); no secrets in tracked files;
    frozen-surface diff stays I5-only.
  - Verify: `npm run typecheck` && `npm run build --workspaces --if-present` &&
    `npm run test:unit -w @life/cache` && `npm run test:unit -w @life/shared` &&
    `npm run test:unit -w @life/tags-service` && `npm run test:unit -w @life/todo-service` &&
    `npm run test:unit -w @life/note-service` && `npm run test:unit -w @life/idp` &&
    `npm run test:unit -w @life/ui` && `npm run test:unit -w @life/app`.
  - Dependencies: T1-T8. Size: M.

## Checkpoints (planning-skill gates, global protocol §8 self-reviewed and logged)

- After T2 (Foundation): note-service suites unchanged-green, health tests green, typecheck clean.
- After T4 (Registry): registry suites green incl. the migration case list.
- After T6 (Consumers): both domains speak TagRef; todo content encryption proven.
- After T8 (UI): Contract 1 mechanical checks green; frozen e2e diff = I5 URLs only.
- After T9: five-lane gate → `tasks/five-lane-todo-ecosystem.md` → report; merge awaits the user.

## Gate log

- 2026-09-28: branch discipline corrected — chapter work on `feature/todo-ecosystem`;
  `master` rewound to `2ea9d48`. No commits land on `master` without the user's
  explicit merge request (now global protocol §8 as well).
- 2026-09-28: Phases 0-3 done (`b21a8c5` intent+map, `8ba80ac` specs, `d55af7f` plan+ledger).
  MAP M1 = Approach 2 (global taxonomy + local references), user-confirmed.
- 2026-09-28: conformance round 1: FAIL 18 → folded (`69515ae`). Round 2: FAIL 10 →
  folded (`001e321`).
- 2026-09-28: conformance round 3: **FAIL, 12 findings** (1 CRITICAL, 4 MAJOR,
  7 MINOR) — all folded in: token model rewritten after the validator proved
  multi-audience tokens infeasible on pinned oidc-provider (now one shared `life-api`
  audience — config-only; RFC 8707 per-resource tokens = upgrade path; idp test
  fixtures + verify owned by T9), T2 registers the health controller (app.module),
  T5 blast radius completed (content-match/backfill suites + both ops scripts' DataSources),
  T1 builds shared/cache dist before typecheck (tsc resolves types from dist),
  `DB_PATH` + volumes named for tags/todo (specs + T9), idp health test = modified,
  `resolveDbPath` per-service resolver named (rule-of-three extraction note),
  migration self-verified `VACUUM INTO` backup, legacy plaintext input handling +
  case, idp `typecheck` alias, T9 build verify, todo route-order constraint
  (`/api/todos/tags` before `:id`), and case counts de-numbered (referenced by spec
  section — kills count drift).
- 2026-09-28: conformance round 4: FAIL, 4 findings (1 CRITICAL, 3 MINOR) — all
  folded in: SPEC-todo-ui's stale per-service audience wording rewritten to the
  shared `life-api` model (kernel is the single source), AGENTS.md restructure
  committed + stray `.bak` removed, stale §-references repointed to Contract 2 /
  global §3, and `version`/`expectedVersion` added to the mutable tag/list rows
  per the kernel concurrency contract.
- 2026-09-28: conformance round 5: FAIL, 9 findings (1 CRITICAL, 3 MAJOR, 5 MINOR) —
  all folded in: `@Public()` health exemption + unauthenticated case (T2 owns the
  guard now), dev-script + Playwright harness wiring for tags/todo (T9, split from
  T8's frozen-URL scope), `.env.example` + README audience lines (T9), inline `#tag`
  parsing explicitly retained (frozen e2e behavior), detach semantics rewritten to
  no-S2S (BFF omits unresolvable ids; writes replace the set), `todo_tag` ON DELETE
  CASCADE, profile/typecheck coverage for ui/app, `version` in tag/list DTOs,
  residual section refs repointed to the global protocol. Round 6: PENDING.
