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
    into `packages/cache` (`@life/cache`) and the LIKE-parity matcher from
    `content-match.ts` into `@life/shared`; refactor note-service onto both with zero
    behavior change. (AGENTS.md §9 no-fork rule, MAP P1.)
  - Files: `packages/cache/**` (new), `packages/shared/src/like-match.ts` + exports +
    `packages/shared/test/like-match.test.ts` (new), `apps/note-service/src/notes/notes-cache.ts`,
    `apps/note-service/src/notes/content-match.ts` (shim/re-export), root `package.json`
    (workspaces += `packages/cache`), `package-lock.json`.
  - Acceptance: `@life/cache` exposes `getThrough(key, loader, {decode, cacheable})`
    with per-owner generation counter, 60s TTL, fail-open, `<svc>:<sub>:v<gen>:<rest>`;
    ported cache + parity suites green; note-service suites unchanged-green.
  - Verify: `npm run test:unit -w @life/cache` && `npm run test:unit -w @life/shared` &&
    `npm run test:unit -w @life/note-service -- test/notes-cache.e2e-spec.ts` && `npm run typecheck`.
  - Dependencies: none. Size: M.
- [ ] T2: health dialect retrofit — module `service-kernel`
  - Description: Add `/health/live` + `/health/ready` to note-service, align idp's
    existing `@Controller('health')` to the dialect (keep `/health` as alias), switch
    compose healthchecks to `/health/ready`.
  - Files: `apps/note-service/src/health/**` (new), `apps/idp/src/health/health.controller.ts`,
    `compose.yaml`, `apps/note-service/test/health.test.ts` + `apps/idp/test/health.test.ts` (new).
  - Acceptance: live = 200 with DB down (no dependency checks); ready = 503 on DB down
    or missing key custody, checks DB + key only (never cache); leak-free bodies;
    compose healthchecks hit `/health/ready`.
  - Verify: `npm run test:unit -w @life/note-service -- test/health.test.ts` &&
    `npm run test:unit -w @life/idp` && `npm run typecheck`.
  - Dependencies: none. Size: S.
- [ ] T3: `apps/tags-service` registry — module `tags-service`
  - Description: New service — `GET/POST /api/tags`, `PATCH/DELETE /api/tags/:id`,
    `POST /api/tags/resolve`; own key custody (`TAGS_MASTER_KEY`), `@life/crypto`
    at rest, `@life/cache`, health routes.
  - Files: `apps/tags-service/**` (new: entities, `tags.module/controller/service`,
    `keys/*`, `health/*`, tests), root `package.json` (workspaces += `apps/tags-service`),
    `package-lock.json`.
  - Acceptance: the 7 cases in SPEC-tags-service Testing Strategy (case-insensitive
    create-or-get, ecosystem rename + 409 collision, delete-detach, owner-scoped
    resolve, ciphertext columns, tamper fail-closed, health); Cache Rules honored
    (`tags:<sub>:v<gen>:all`, ciphertext-only).
  - Verify: `npm run test:unit -w @life/tags-service` && `npm run typecheck`.
  - Dependencies: T1 (uses `@life/cache`). Size: L.
- [ ] T4: `import-tags` migration script — module `tags-extraction`
  - Description: Id-preserving, idempotent note-DB → tags-DB import (re-encrypt under
    registry DEKs, `_legacy_` sentinel), `--dry-run`, batched transactions, poisoned-row
    abort; deploy checklist in the script header. Human-run later (hard line).
  - Files: `apps/tags-service/scripts/import-tags.ts`, `apps/tags-service/src/tags/import.ts`,
    `apps/tags-service/test/import-tags.test.ts` (new), `apps/tags-service/package.json` (script).
  - Acceptance: the 7 cases in SPEC-tags-extraction Testing Strategy (import+ids preserved,
    idempotence, dry-run purity + count parity, `_legacy_`, poisoned-row abort,
    TagRef behaviors, note round-trip).
  - Verify: `npm run test:unit -w @life/tags-service -- test/import-tags.test.ts` && `npm run typecheck`.
  - Dependencies: T3. Size: M.
- [ ] T5: note-service TagRef conversion — module `tags-extraction`
  - Description: note-service stops owning tag names — `tags: string[]` DTOs → `tagIds: number[]`;
    `note_tag` association only (ids unchanged); `GET /api/notes/tags` → `[{tagId,count}]`;
    tag filter by id (metadata-only SQL); lazy prune of dangling ids; `note:tags` cache
    shape becomes id+count rows.
  - Files: `apps/note-service/src/notes/notes.service.ts`, `note.entity.ts`,
    `tag.entity.ts` (association-only or remove), `notes.controller.ts`, `tags.controller.ts`,
    `notes-cache.ts` integration, `apps/note-service/test/tag-refs.test.ts` (new).
  - Acceptance: note-service holds zero tag names; TagRef attach/detach/filter/`{tagId,count}`
    behaviors; unknown-id prune; content filtering unchanged (decrypt-then-match).
  - Verify: `npm run test:unit -w @life/note-service -- test/tag-refs.test.ts` && `npm run typecheck`.
  - Dependencies: T3. Size: M.
- [ ] T6: `apps/todo-service` — module `todo-service`
  - Description: New service — todos (title, note, done, dueDate) + lists + TagRefs +
    `origin` links; own key custody (`TODO_MASTER_KEY`), `@life/crypto` at rest,
    `@life/cache`, health routes; the 8 API surfaces in SPEC-todo-service.
  - Files: `apps/todo-service/**` (new: entities, todo/list modules+controllers+services,
    `keys/*`, `health/*`, tests), root `package.json` (workspaces += `apps/todo-service`),
    `package-lock.json`.
  - Acceptance: the 8 test groups in SPEC-todo-service Testing Strategy (envelope
    round-trip, AAD swap fail-closed, LIKE parity empirical, ordering+filters+pagination,
    list detach, TagRef prune + count, cache ciphertext-only, health + version/409).
  - Verify: `npm run test:unit -w @life/todo-service` && `npm run typecheck`.
  - Dependencies: T1 (`@life/cache`, `likeMatch`), T3 (TagRef contract). Size: L.
- [ ] T7: `@life/ui` upstream additions — module `todo-ui`
  - Description: TagPicker/TagManager block + due-date pill (or as needed) added
    **upstream** with spec updates before apps consume them (AGENTS.md §3 Rule 3).
  - Files: `packages/ui/src/**`, `packages/ui/test/**`, `docs/specs/SPEC-ui-*.md`,
    `docs/specs/MAP-ui-primitives.md`, `packages/ui/src/styles/tokens.css` (only if new token).
  - Acceptance: primitives covered by `@life/ui` tests; spec + map updated in the same
    change; no raw-HTML/raw-value/token leaks (§3 mechanical checks).
  - Verify: `npm run test:unit -w @life/ui` && `npm run typecheck`.
  - Dependencies: none (can precede T8). Size: M.
- [ ] T8: `apps/app` UI — module `todo-ui`
  - Description: Move `/` → `/notes` (+ redirect), build `/todos` (grouped
    Overdue/Today/Later/No date, done toggle, composer, inline edit, filters), wire the
    shared tag picker/manager to `tags-service` from both apps, rework the note composer
    to `tagIds`, update Playwright navigation to the I5 URLs.
  - Files: `apps/app/app/**` (route move + new `/todos`), `apps/app/lib/**` / `actions.ts`,
    `apps/app/test/**`, `tests/e2e/*.spec.ts` (URL navigation only — I5-approved).
  - Acceptance: `/notes` + `/todos` live, `/` redirects; tags one vocabulary across both
    apps; §3 mechanical checks green; frozen e2e diff = I5 URLs and nothing else.
  - Verify: `npm run test:unit -w @life/app` && `npm run build -w @life/app` && `npm run typecheck`.
  - Dependencies: T5 (note-service TagRef), T6 (todo-service), T7 (primitives). Size: L.
- [ ] T9: wiring + integration pass — module `todo-ui` (close)
  - Description: compose services for tags/todo (env keys, healthchecks, deps),
    `.env.development.example` documented placeholders + untracked dev keys, Dockerfiles
    (new `packages/cache` + new app workspaces + builds), full integration pass.
  - Files: `compose.yaml`, `.env.development.example`, untracked `.env.development`,
    `apps/*/Dockerfile`, `packages/*/Dockerfile` as needed.
  - Acceptance: dev stack boots with dev keys; `npm run typecheck` + builds green; all
    targeted suites green in one pass; no secrets in tracked files; frozen-surface diff
    stays I5-only.
  - Verify: `npm run typecheck` + `npm run test:unit -w @life/{cache,shared,tags-service,todo-service,note-service,app,ui}`.
  - Dependencies: T1-T8. Size: M.

## Checkpoints (planning-skill gates, §8 self-reviewed and logged)

- After T2 (Foundation): note-service suites unchanged-green, health tests green, typecheck clean.
- After T4 (Registry): registry suites green incl. the 7 migration cases.
- After T6 (Consumers): both domains speak TagRef; todo content encryption proven.
- After T8 (UI): §3 mechanical checks green; frozen e2e diff = I5 URLs only.
- After T9: five-lane gate → `tasks/five-lane-todo-ecosystem.md` → report; merge awaits the user.

## Gate log

- 2026-09-28: branch discipline corrected — chapter work moved to `feature/todo-ecosystem`;
  `master` rewound to `2ea9d48` (pre-chapter). Standing rule restated: no commits land
  on `master` without the user's explicit merge request.
- 2026-09-28: Phase 0 (intent + capability map) + Phase 1 (5 module specs) done and
  committed (`b21a8c5`, `8ba80ac`). Approaches resolved: MAP M1 = Approach 2 (global
  taxonomy + local references) confirmed against the user's architectural guidance.
- 2026-09-28: Phase 2/3 (plan + ledger) done — this file. Pre-IMPLEMENT conformance
  pass: PENDING (next).
