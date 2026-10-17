# Spec: Notes list ordered by `contentUpdatedAt`

Date: 2026-10-16
Status: Draft — pending human review
Traces to intent: `docs/intent/notes-sort-by-content-updated.md`
Scope: single capability (no capability map)

## 0. Scope Check

One capability, one spec. The acceptance criteria — bump-on-body-edit, list order, cursor
pagination on the new key, legacy backfill — share one consumer (the notes list) and one
data change (`note.contentUpdatedAt`); cutting any one breaks the capability rather than
shipping a smaller one. No capability map, no `SPEC-<module>.md` split. Stored at the
repo's spec home (`docs/specs/`, per AGENTS.md and the 60 existing `SPEC-*.md` files),
named for the capability: `SPEC-notes-content-order.md`.

## 1. Assumptions

```
ASSUMPTIONS I'M MAKING:
1. Single capability → one spec at docs/specs/SPEC-notes-content-order.md (the repo's
   established spec home; a root SPEC.md would be a second, duplicate spec system).
2. `contentUpdatedAt` is a nullable `datetime` column on `note` (same ALTER-safe nullable
   pattern as `ownerSub`). NULL exists only pre-backfill; every read treats NULL as
   `createdAt`, so deploying before the backfill runs does not reshuffle anything.
3. `create` stamps `contentUpdatedAt = createdAt` — the first body set counts as a content
   edit, so a freshly created note is the top row.
4. `update()` bumps `contentUpdatedAt` only when the request carries `body` (the write
   already re-encrypts on every body send; no plaintext comparison). A tag-only or
   version-bump-only PATCH never bumps it. Trash/restore/remove never bump it.
5. The wire DTO (`NoteDto` in `packages/shared`) is unchanged — no `contentUpdatedAt` on
   the API ("no display of edit times" is out of scope and no consumer needs it; the
   cursor carries list position). Row meta stays `createdAt`.
6. The cache row (`CachedNoteRow` / `toCachedNoteRow`) grows `contentUpdatedAt`; the
   cached-row decoder tolerates entries missing it and falls back to `createdAt`, so
   pre-deploy Redis entries survive the deploy.
7. Cursor wire format `base64(<isoTimestamp>|<id>)` is unchanged; only the timestamp it
   carries becomes `contentUpdatedAt`. In-flight pre-deploy cursors keep decoding and
   degrade to one slightly-stale page boundary — accepted.
8. Trash order (`deletedAt DESC`) and `keys/backfill.ts`'s internal scan order
   (`createdAt ASC, id ASC`) are untouched.
→ Correct me now or I'll proceed with these.
```

## 2. Objective

Notes are currently listed `createdAt DESC` — birth-date order buries a recently edited
old note and the owner has to scroll to find the note they just wrote in. The list orders
by `contentUpdatedAt DESC`, a new column bumped only when a note's body changes. The
displayed row timestamp stays `createdAt`.

User stories / acceptance criteria:

- **AC1** — As the note owner, I edit a note's body and it is the top row of the notes
  list (`/`, and the same filtered views).
- **AC2** — Retagging a note (tag-only PATCH), trashing it, or restoring it leaves its
  list position unchanged.
- **AC3** — A newly created note is the top row (its `contentUpdatedAt` = `createdAt`).
- **AC4** — Cursor pagination over the new key returns every note exactly once — no
  duplicates, no skips — across page boundaries, including ties on `contentUpdatedAt`
  (tie-break `id DESC`, matching today's rule).
- **AC5** — Legacy rows keep their pre-deploy order: backfill sets
  `contentUpdatedAt = createdAt` (deliberately not `updatedAt` — trash/tag ops bumped
  that). Deploy is a no-op for list order until a real body edit happens.
- **AC6** — `updatedAt` keeps its generic row-timestamp semantics; `version` remains the
  optimistic-conflict token (per `SPEC-notes-ui.md`, `updatedAt` is not a conflict
  token). Neither is repurposed.

## 3. Commands

```
Typecheck (apps/note-service):  npm run typecheck            # workspace-aware; run in the touched workspace
Typecheck (apps/app):           npm run typecheck            # only if a UI task ends up touching apps/app
Unit/e2e API (note-service):    npm run test:unit -- test/notes.e2e-spec.ts        # from apps/note-service (jest)
Cache tests (note-service):     npm run test:unit -- test/notes-cache.e2e-spec.ts  # from apps/note-service (jest)
UI e2e (only if UI changes):    npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

Max test runs: **2** per suite. Never widened to full-suite runs.

## 4. Project Structure

```
apps/note-service/src/notes/note.entity.ts      → the `contentUpdatedAt` column
apps/note-service/src/notes/notes.service.ts    → the single writer (`update()` on body),
                                                  list order + cursor (`findAll`/`paginate`),
                                                  cached-row encode/decode
apps/note-service/test/notes.e2e-spec.ts        → order, bump semantics, cursor tests
apps/note-service/test/notes-cache.e2e-spec.ts  → cached-row ciphertext + decoder-tolerance tests
apps/app/app/note-list.tsx                      → no change expected (renders API order,
                                                  row meta stays `note.createdAt`)
apps/note-service/scripts/backfill-content-updated-at.ts → the human-run ALTER + backfill script
apps/note-service/test/backfill-content-updated-at.test.ts → backfill script step tests
docs/runbooks/production-deploy.md              → human-run backfill checklist entry
docs/specs/SPEC-notes-content-order.md          → this spec
tasks/plan.md                                   → implementation plan (later phase, not this artifact)
```

Data model change (existing DBs — human-run, hard-lines). The one-time script
(`npm run backfill-content-updated-at -w apps/note-service`, `backfill-owner.ts` shape:
verified `VACUUM INTO` backup first, then) applies exactly:

```sql
ALTER TABLE "note" ADD COLUMN "contentUpdatedAt" datetime;
UPDATE "note" SET "contentUpdatedAt" = "createdAt" WHERE "contentUpdatedAt" IS NULL;
```

Fresh dev DBs get the column via the boot-time schema sync; `create` always stamps it, so
NULL rows exist only in the pre-backfill window and read as `createdAt`.

## 5. Code Style

Repo style: TypeScript strict, intent-explaining comments only where a non-obvious
tradeoff lives, nullable columns justified in place. The new column reads like the
existing one it patterns after:

```ts
  // Nullable so a legacy DB can `ALTER TABLE ADD COLUMN` safely; NULL rows are
  // pre-deploy notes, read as `createdAt` until the human-run backfill runs.
  // Bumped only by body writes (NotesService.update on `body`), never by
  // retag/trash/restore.
  @Column({ type: 'datetime', nullable: true })
  contentUpdatedAt: Date | null;
```

## 6. Testing Strategy

Framework: Jest (`npm run test:unit -- <file>`, from the owning workspace). Service-level
tests run as Nest e2e specs against the real app (supertest, pattern:
`apps/note-service/test/notes.e2e-spec.ts`); cache tests follow
`notes-cache.e2e-spec.ts`'s ciphertext-test pattern.

- **Order + bump semantics (AC1–AC3, AC6)** → `notes.e2e-spec.ts`: create A then B
  (list `[B, A]`); PATCH A `body` → `[A, B]`; PATCH A `tagIds` only → position unchanged;
  trash A and restore A → position unchanged; assert `updatedAt`/`version` behave exactly
  as before (version still increments on every successful PATCH).
- **Cursor pagination (AC4)** → same file: ≥3 notes with distinct `contentUpdatedAt`,
  walk `limit=1` pages to exhaustion, assert each id exactly once; one tie case on equal
  `contentUpdatedAt` covered by the `id DESC` tie-break.
- **Cache rules** → `notes-cache.e2e-spec.ts`: cached rows serialize `contentUpdatedAt`;
  a cached entry **missing** the field decodes without error and orders as `createdAt`
  (one test for the tolerance); existing ciphertext assertions (`enc.v1.` present, no
  known plaintext in the serialized value) still hold.
- **Trash order regression** → existing trash tests unchanged (`deletedAt DESC`).
- **UI**: no new tests — order is server-driven; the row meta display (`createdAt`) is
  frozen surface and untouched.

Coverage expectation: every AC in §2 maps to at least one named assertion above; no
numeric coverage bar.

## 7. Cache Rules

- **Cached shape**: `CachedNoteRow` gains `contentUpdatedAt: string | null` (ISO). The
  value is a row timestamp — no content, no new plaintext risk — but the row set as a
  whole stays ciphertext-only (`body` is an `enc.v1.` envelope; legacy plaintext rows are
  never cached). The decoder tolerates entries missing the field (treat as `createdAt`)
  so pre-deploy Redis entries survive one generation bump.
- **Key composition**: unchanged — `note:<sub>:v<gen>:list` (and `:trash`). The key
  reflects the fetch, not the request: `contentUpdatedAt` is a row field, so it never
  enters the key; `q`/`tagId`/`limit`/`cursor` still never enter it.
- **Invalidation**: unchanged — per-owner generation counter bumped on successful writes
  (including body edits, which is what moves a note to the top), TTL backstop.
- **Failure mode**: unchanged — fail-open to the direct loader on any cache error; the
  fallback path never writes plaintext.

## 8. Boundaries

- **Always do**: bump `contentUpdatedAt` only from body writes (`update()` with `body`,
  plus `create`); treat NULL as `createdAt` in every read path; keep `updatedAt`/`version`
  semantics untouched; run `npm run typecheck` and the targeted jest file before calling
  the work done; keep cache values ciphertext rows; document the ALTER + backfill in the
  production-deploy runbook for the human to run.
- **Ask first**: changing the wire DTO (adding `contentUpdatedAt`, or exposing any edit
  time); changing the cursor wire format; touching trash order; any production data
  migration beyond documenting it; adding an index on `contentUpdatedAt`.
- **Never do**: run the `ALTER TABLE`/backfill `UPDATE` against production ourselves
  (hard-lines: production data migrations are human-run); fake the bump via `updatedAt`
  or a DB trigger; sort in the UI to paper over wrong server order; display edit times;
  add "last opened" tracking or a sort toggle (out of scope); change the e2e selector
  surface, token values, or PWA constants; strip the legacy-NULL tolerance from the cache
  decoder; exceed the 2-run test budget or widen commands beyond the repo profile.

## 9. Success Criteria

Specific and testable:

1. `npm run typecheck` exits 0 in `apps/note-service`.
2. `npm run test:unit -- test/notes.e2e-spec.ts` (from `apps/note-service`, within 2
   runs) passes with assertions: create A, create B → `[B, A]`; PATCH A `body` → `[A, B]`;
   PATCH A `tagIds` only → order unchanged; trash A + restore A → order unchanged; a
   `limit=1` cursor walk over ≥3 notes returns every id exactly once (no duplicates, no
   skips).
3. `npm run test:unit -- test/notes-cache.e2e-spec.ts` passes: cached rows carry
   `contentUpdatedAt`; a decoded entry missing the field orders as `createdAt` without
   throwing; `enc.v1.`/no-plaintext assertions hold.
4. Trash listing order still `deletedAt DESC` (existing tests green).
5. `grep -rn "contentUpdatedAt" apps/app` → zero hits; `apps/app/app/note-list.tsx` row
   meta is still `note.createdAt`.
6. `docs/runbooks/production-deploy.md` contains the exact `ALTER TABLE` + backfill
   `UPDATE` statements from §4 as a human-run checklist item, with the note that
   `contentUpdatedAt = createdAt` (not `updatedAt`) preserves pre-deploy order.
7. A body edit followed by list fetch moves the note to the top row with no cache
   artifacts: after the generation bump, the reloaded row set orders by
   `contentUpdatedAt DESC, id DESC` in both the cached and loader paths.

## 10. Open Questions

1. **Identical-plaintext body PATCH**: currently counts as a content edit and bumps
   (assumption 4) — comparing plaintext would force a decrypt-before-write and is
   rejected as complexity. Is "the client sent `body`, so it changed" the right bar?
2. **Wire exposure**: if keeping `contentUpdatedAt` off `NoteDto` complicates the
   in-memory filter/pagination plumbing (filter runs post-decrypt over DTOs that today
   carry no such field), is adding it to the DTO acceptable given it is never displayed —
   or must the plumbing carry it out-of-band to keep the wire shape frozen?
3. **In-flight pre-deploy cursors**: accepted as one slightly-stale page boundary
   (assumption 7), or should cursors be invalidated at deploy (e.g. a version marker in
   the cursor token)?
4. **Index**: `findAll`'s loader orders in SQL over the owner's rows with no
   `createdAt` index today; parity says no `contentUpdatedAt` index now. Confirm the
   list stays small enough to keep that call, or ask for the index before implement.
