# Task Ledger: todo-ecosystem

Plan: `tasks/plan-todo-ecosystem.md` · Map + specs: `docs/specs/MAP-todo-ecosystem.md`
+ `SPEC-{service-kernel,tags-service,tags-extraction,todo-service,todo-ui}.md` ·
Intent: `docs/intent/todo-ecosystem.md`.

Branch: `feature/todo-ecosystem`. Process: AGENTS.md §8 (autonomous after the intent
gate) + §6 review lifecycle per task (blast radius + contract validation + UI/Backend
checks + execution audit + tech-lead final verification). Each task = one subagent
(AGENTS.md template), TDD, tech-lead diff review + commit. Targeted tests, ≤2 runs
per task. Merge to `master` on the user's explicit request only.

## Tasks

- [ ] T1: shared kernel primitives (`@life/cache` + `likeMatch`) — module `service-kernel`
  - Description: Extract the generic read-through cache from `apps/note-service/src/notes/notes-cache.ts`
    into `packages/cache` (`@life/cache`, per SPEC-service-kernel's generic signature:
    `createCache({service, client, ttlSeconds})` → `getThrough(sub, rest, loader, opts)`)
    and the LIKE-parity matcher from `content-match.ts` into `@life/shared`; refactor
    note-service onto both with zero behavior change. (AGENTS.md §9 no-fork rule, MAP P1.)
  - Files: `packages/cache/**` (new), `packages/shared/src/like-match.ts` (new),
    `packages/shared/src/index.ts` (barrel re-export of `likeMatch`),
    `packages/shared/test/like-match.test.ts` (new), `packages/shared/package.json`
    (add jest config + `test:unit` script — shared has neither today),
    `apps/note-service/package.json` (add `@life/cache` dep + jest `moduleNameMapper`
    `"^@life/cache$": "<rootDir>/../../packages/cache/src/index.ts"` — mirrors the
    `@life/crypto`/`@life/shared` source-resolution pattern; `@life/cache`'s `main`
    points at `dist/` like `@life/shared`, tests resolve to `src/`),
    `apps/note-service/src/notes/notes-cache.ts`, `apps/note-service/src/notes/content-match.ts`
    (thin re-export shim so call sites/tests keep compiling), root `package.json`
    (workspaces += `packages/cache`), `package-lock.json` (via `npm install` only).
  - Acceptance: `@life/cache` honors the kernel contract (key composition
    `<service>:<sub>:v<gen>:<rest>`, gen-counter, 60s TTL, fail-open, ciphertext-only
    value discipline); ported cache + parity suites green; note-service suites
    unchanged-green.
  - Verify: `npm run test:unit -w @life/cache` && `npm run test:unit -w @life/shared` &&
    `npm run test:unit -w @life/note-service -- test/notes-cache.e2e-spec.ts` && `npm run typecheck`.
  - Dependencies: none. Size: M.
- [ ] T2: health dialect retrofit — module `service-kernel`
  - Description: Add `/health/live`, `/health/ready`, and the `/health` alias
    (readiness semantics) to note-service; align idp's existing
    `@Controller('health')` to the same trio; switch compose healthchecks to
    `/health/ready`. The `/health` alias is load-bearing: the Playwright harness
    (`apps/app/test/e2e/stack.ts`) polls it and treats `<500` as ready.
  - Files: `apps/note-service/src/health/**` (new), `apps/note-service/test/health.e2e-spec.ts`
    (new), `apps/idp/src/health/health.controller.ts`, `apps/idp/test/health.e2e-spec.ts`
    (new — idp's jest `testRegex` is `.e2e-spec.ts$`, so the file MUST carry that suffix),
    `apps/idp/package.json` (add `test:unit` alias → `test`), `compose.yaml` (healthcheck
    commands only).
  - Acceptance: live = 200 with DB down (no dependency checks); ready = 503 on DB down
    or missing key custody (DB + key only, never cache); `/health` answers identically
    to `/health/ready` on both services; leak-free bodies; compose healthchecks hit
    `/health/ready`.
  - Verify: `npm run test:unit -w @life/note-service -- test/health.e2e-spec.ts` &&
    `npm run test:unit -w @life/idp` && `npm run typecheck`.
  - Dependencies: none. Size: S.
- [ ] T3: `apps/tags-service` registry — module `tags-service`
  - Description: New service — `GET/POST /api/tags`, `PATCH/DELETE /api/tags/:id`,
    `POST /api/tags/resolve`; own key custody (`TAGS_MASTER_KEY`), `@life/crypto`
    at rest, `@life/cache`, health routes. Registers itself in the root workspace so
    its verify commands resolve.
  - Files: `apps/tags-service/**` (new: package.json with `build`/`typecheck`/
    `test:unit` scripts, entities, `tags.module/controller/service`, `keys/*`,
    `health/*`, tests), root `package.json` (workspaces += `apps/tags-service`),
    `package-lock.json` (via `npm install` only). NOT included:
    `apps/tags-service/Dockerfile` (T9's), `compose.yaml` (T9's).
  - Acceptance: the 7 cases in SPEC-tags-service Testing Strategy (case-insensitive
    create-or-get, ecosystem rename + 409 collision, delete-detach, owner-scoped
    resolve, ciphertext columns, tamper fail-closed, health); Cache Rules honored
    (`tags:<sub>:v<gen>:all`, ciphertext-only); `npm run build -w @life/tags-service`
    produces dist.
  - Verify: `npm run test:unit -w @life/tags-service` &&
    `npm run build -w @life/tags-service` && `npm run typecheck`.
  - Dependencies: T1 (uses `@life/cache`). Size: L.
- [ ] T4: `import-tags` migration script — module `tags-extraction`
  - Description: Id-preserving, idempotent note-DB → tags-DB import (re-encrypt under
    registry DEKs, `_legacy_` sentinel), `--dry-run`, batched transactions,
    poisoned-row abort, and the final schema surgery (`note_tag` rebuilt without the
    FK to `tag`, then `tag` table dropped — `PRAGMA foreign_keys=OFF` window, the
    `backfill-owner` precedent). Deploy checklist in the script header. Human-run
    later (hard line).
  - Files: `apps/tags-service/scripts/import-tags.ts`, `apps/tags-service/src/tags/import.ts`,
    `apps/tags-service/test/import-tags.test.ts` (new), `apps/tags-service/package.json`
    (script `import-tags` → `ts-node scripts/import-tags.ts`).
  - Acceptance: the 6 cases in SPEC-tags-extraction Testing Strategy, migration-owned
    only: import + ids preserved, idempotence, dry-run purity + count parity,
    `_legacy_` round-trip, poisoned-row abort, schema surgery (no `tag` table, FK-free
    `note_tag`, inserts succeed). The TagRef/round-trip behaviors belong to T5's suite.
  - Verify: `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts` && `npm run typecheck`.
  - Dependencies: T3. Size: M.
- [ ] T5: note-service TagRef conversion — module `tags-extraction`
  - Description: note-service stops owning tag names — `tags: string[]` DTOs → `tagIds: number[]`;
    `note_tag` association only via an explicit `NoteTag` join entity mapped to the
    existing `note_tag` table (no `Tag` entity remains; `tagId` plain integer, no FK —
    registry is external per Approach 2); `GET /api/tags` (existing route) changes
    shape in place to `[{tagId, count}]`; tag filter by id (metadata-only SQL); lazy
    prune of dangling ids; `note:tags` cache shape becomes id+count rows. Existing
    suites that pin the old shapes are updated to the TagRef contract in this task.
  - Files: `apps/note-service/src/notes/notes.service.ts`, `note.entity.ts`,
    `tag.entity.ts` (removed, replaced by `note-tag.entity.ts` (new)), `notes.controller.ts`,
    `tags.controller.ts`, `apps/note-service/src/notes/dto/**` (`tags` → `tagIds`),
    `apps/note-service/src/notes/notes.module.ts` + `apps/note-service/src/app.module.ts`
    (entity registration), `packages/shared/src/index.ts` (shared input types:
    `CreateNoteInput.tags` → `tagIds`, `UpdateNoteInput`, `Tag` → `TagRef`),
    `notes-cache.ts` integration, `apps/note-service/test/tag-refs.test.ts` (new),
    and the existing suites pinned to old shapes: `test/notes.e2e-spec.ts`,
    `test/ownership.e2e-spec.ts`, `test/notes-cache.e2e-spec.ts`,
    `test/crypto-roundtrip.test.ts`.
  - Acceptance: note-service holds zero tag names; TagRef attach/detach/filter/
    `[{tagId,count}]` + unknown-id prune + note round-trip with `tagIds`
    (SPEC-tags-extraction "Owned by T5" list); the four existing suites updated and
    green against the TagRef contract; content filtering unchanged (decrypt-then-match).
  - Verify: `npm run test:unit -w @life/note-service` && `npm run typecheck`.
  - Dependencies: T3. Size: L (borderline; single concern — the whole note-service tag surface).
- [ ] T6: `apps/todo-service` — module `todo-service`
  - Description: New service — todos (title, note, done, dueDate) + lists + TagRefs +
    `origin` links; own key custody (`TODO_MASTER_KEY`), `@life/crypto` at rest,
    `@life/cache`, health routes; the 10 endpoints in SPEC-todo-service (5 todo + 4
    list + 1 usage). Registers itself in the root workspace.
  - Files: `apps/todo-service/**` (new: package.json with `build`/`typecheck`/
    `test:unit` scripts, entities, todo/list modules+controllers+services, `keys/*`,
    `health/*`, tests), root `package.json` (workspaces += `apps/todo-service`),
    `package-lock.json` (via `npm install` only). NOT included:
    `apps/todo-service/Dockerfile` (T9's), `compose.yaml` (T9's).
  - Acceptance: the 8 test groups in SPEC-todo-service Testing Strategy (envelope
    round-trip, AAD swap fail-closed, LIKE parity empirical, ordering+filters+pagination,
    list detach, TagRef prune + count, cache ciphertext-only for content shapes +
    metadata-only tag usage, health + version/409); `npm run build -w @life/todo-service`
    produces dist.
  - Verify: `npm run test:unit -w @life/todo-service` &&
    `npm run build -w @life/todo-service` && `npm run typecheck`.
  - Dependencies: T1 (`@life/cache`, `likeMatch`), T3 (TagRef contract). Size: L.
- [ ] T7: `@life/ui` upstream additions — module `todo-ui`
  - Description: The named primitives, added **upstream** with spec updates before
    apps consume them (AGENTS.md §3 Rule 3): `TagPicker` (attach/detach by id),
    `TagManager` (create/rename/delete), `DueDatePill` (due-date display/grouping).
  - Files: `packages/ui/src/**`, `packages/ui/test/**`, `packages/ui/package.json`
    (add `test:unit` alias → `test`), `docs/specs/SPEC-ui-*.md`,
    `docs/specs/MAP-ui-primitives.md`, `packages/ui/src/styles/tokens.css` (only if new token).
  - Acceptance: the three primitives covered by `@life/ui` tests; spec + map updated in
    the same change; no raw-HTML/raw-value/token leaks (§3 mechanical checks).
  - Verify: `npm run test:unit -w @life/ui` && `npm run typecheck`.
  - Dependencies: none (can precede T8). Size: M.
- [ ] T8: `apps/app` UI — module `todo-ui`
  - Description: Move `/` → `/notes` (+ redirect), build `/todos` (grouped
    Overdue/Today/Later/No date, done toggle, composer, inline edit, filters), wire the
    shared `TagPicker`/`TagManager` to `tags-service` from both apps, rework the note
    composer to `tagIds`, add the app-side transport config (`TAGS_API_URL`,
    `TODO_API_URL`; the single multi-audience token model per the kernel contract
    means the session shape is unchanged), update Playwright navigation to the I5 URLs.
  - Files: `apps/app/app/**` (route move + new `/todos`), `apps/app/lib/**`, `actions.ts`,
    `apps/app/test/**` (incl. `apps/app/test/e2e/**` — navigation URLs only, I5-approved).
  - Acceptance: `/notes` + `/todos` live, `/` redirects; tags one vocabulary across both
    apps; §3 mechanical checks green; frozen e2e diff = I5 URLs and nothing else.
  - Verify: `npm run test:unit -w @life/app` && `npm run build -w @life/app` && `npm run typecheck`.
  - Dependencies: T5 (note-service TagRef), T6 (todo-service), T7 (primitives). Size: L.
- [ ] T9: wiring + integration pass — module `todo-ui` (close)
  - Description: Create `apps/tags-service/Dockerfile` and `apps/todo-service/Dockerfile`;
    update `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`
    for the new `packages/cache` + new workspace manifests (the data-privacy
    deploy-blocker lesson); compose services for tags/todo (env per the kernel
    transport contract: `TAGS_IDP_JWKS_URL`/`TODO_IDP_JWKS_URL`, `TAGS_SERVICE_AUDIENCE`/
    `TODO_SERVICE_AUDIENCE`, `REDIS_URL` for both — shared `redis-note` instance,
    service-prefixed keys make it safe); IdP multi-audience token minting +
    `OIDC_AUDIENCE_MAP` extension (apps/idp/src — one access token carrying
    `aud: [note-service, tags-service, todo-service]` per the kernel token model);
    `.env.development.example` documented placeholders + untracked dev keys
    (`TAGS_MASTER_KEY`, `TODO_MASTER_KEY`); full integration pass.
  - Files: `compose.yaml`, `.env.development.example`, untracked `.env.development`,
    `apps/app/Dockerfile`, `apps/idp/Dockerfile`, `apps/note-service/Dockerfile`,
    `apps/tags-service/Dockerfile` (new), `apps/todo-service/Dockerfile` (new),
    `apps/idp/src/**` (audience-minting changes only). T3/T6 must NOT create
    Dockerfiles or touch compose.
  - Acceptance: dev stack boots with dev keys; all three services authenticate the
    app's token (multi-audience `aud` verified per service); `npm run typecheck` +
    builds green; all targeted suites green in one pass; no secrets in tracked files;
    frozen-surface diff stays I5-only.
  - Verify: `npm run typecheck` && `npm run test:unit -w @life/cache` &&
    `npm run test:unit -w @life/shared` && `npm run test:unit -w @life/tags-service` &&
    `npm run test:unit -w @life/todo-service` && `npm run test:unit -w @life/note-service` &&
    `npm run test:unit -w @life/ui` && `npm run test:unit -w @life/app`.
  - Dependencies: T1-T8. Size: M.

## Checkpoints (planning-skill gates, §8 self-reviewed and logged)

- After T2 (Foundation): note-service suites unchanged-green, health tests green, typecheck clean.
- After T4 (Registry): registry suites green incl. the 6 migration cases.
- After T6 (Consumers): both domains speak TagRef; todo content encryption proven.
- After T8 (UI): §3 mechanical checks green; frozen e2e diff = I5 URLs only.
- After T9: five-lane gate → `tasks/five-lane-todo-ecosystem.md` → report; merge awaits the user.

## Gate log

- 2026-09-28: branch discipline corrected — chapter work moved to `feature/todo-ecosystem`;
  `master` rewound to `2ea9d48` (pre-chapter). Standing rule restated: no commits land
  on `master` without the user's explicit merge request.
- 2026-09-28: Phase 0 (intent + capability map) + Phase 1 (5 module specs) done and
  committed (`b21a8c5`, `8ba80ac`). MAP M1 = Approach 2 (global taxonomy + local
  references) confirmed against the user's architectural guidance.
- 2026-09-28: Phase 2/3 (plan + ledger) done (`d55af7f`).
- 2026-09-28: pre-IMPLEMENT conformance round 1 (fresh-context validator): **FAIL,
  18 findings** (1 CRITICAL, 8 MAJOR, 9 MINOR) — all folded in (`69515ae`): byte-identical
  404 precedent, test:unit/jest ownership, idp `.e2e-spec` naming, `@life/cache`
  resolution, todo cache-key contradiction, ciphertext scope, `/api/tags` in-place
  shape change, transport contract, T4/T5 acceptance split, `## Cache Rules` heading,
  DB-path defaults, supersession pointer, generic cache signature, `NoteTag` entity,
  named UI primitives, real e2e path, Dockerfile ownership, `/health` alias.
- 2026-09-28: conformance round 2: **FAIL, 10 findings** (1 CRITICAL, 4 MAJOR,
  5 MINOR) — all folded in: root `workspaces` registration + lockfile ownership (T3/T6),
  T5's real blast radius (DTOs, shared input types, module/entity registration, the
  four pinned suites), token model specified (single multi-audience access token,
  verifiers check presence; RFC 8707 per-resource tokens = documented upgrade path;
  IdP minting owned by T9), `REDIS_URL` wiring documented, plan's "seven"→"six",
  T1 barrel named, `origin` union closed, T3/T6 build verify commands. Round 3: PENDING.
