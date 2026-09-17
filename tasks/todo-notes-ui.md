# Tasks: Notes UI/UX — Editing & Search

Plan: `tasks/plan-notes-ui.md` · Spec: `docs/specs/SPEC-notes-ui.md`
Branch: `feat/notes-ui-redesign`

---

## Task 1: Light/dark tokens + System/Light/Dark toggle

**Description:** Add a light token set alongside the existing dark `:root` tokens in
`globals.css`, add a `theme-toggle.tsx` client control cycling System → Light → Dark, and add
an inline pre-paint script in `layout.tsx` that applies the persisted choice. Set
`color-scheme: light dark` and a light/dark `themeColor` pair.

**Acceptance criteria:**
- [ ] Light and dark palettes both render with readable contrast.
- [ ] Toggle cycles System → Light → Dark; `aria-label`/`aria-pressed` present.
- [ ] Forced choice persists across reload with no flash of the wrong theme.
- [ ] System (default) follows `prefers-color-scheme`.
- [ ] No new dependency.

**Verification:**
- [ ] Manual: toggle each state, reload, inspect in both OS schemes.
- [ ] `npm run lint` passes.

**Dependencies:** None
**Files:** `apps/web/app/globals.css`, `apps/web/app/theme-toggle.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
**Scope:** Medium

---

## Task 2: Open an existing note in a full-screen editor with autosave + Done

**Description:** Add route `app/notes/[id]/page.tsx` (Server Component) that loads the note
via a new `getNote(id)` in `lib/api.ts` and renders a `note-editor.tsx` client component:
full-height autofocused textarea, 400ms debounced autosave through the existing
`updateNote` Server Action, a `Saving…` / `Saved` / `Couldn't save` indicator, and a Done
control that flushes then returns to `/`.

**Acceptance criteria:**
- [ ] `/notes/[id]` opens full screen with the cursor in the body; typing starts with no extra tap.
- [ ] Pausing typing autosaves; indicator shows `Saving…` → `Saved`.
- [ ] Reloading after an edit shows the persisted body.
- [ ] Done flushes the pending save and returns to the list.
- [ ] Unknown id renders a not-found state, not a crash.

**Verification:**
- [ ] Manual: edit, pause, reload, confirm persistence.
- [ ] `npm run build` succeeds.

**Dependencies:** None (list navigation wired in Task 3)
**Files:** `apps/web/app/notes/[id]/page.tsx`, `apps/web/app/note-editor.tsx`, `apps/web/lib/api.ts`, `apps/web/app/actions.ts`
**Scope:** Medium

---

## Task 3: Home list restyle + tap navigation + "+"; remove capture box

**Description:** Rewrite `page.tsx` to drop the capture form, add a "+" control linking to
`/notes/new`, and restyle `note-list.tsx` rows to Apple-like title (first line) / snippet
(2 lines) / date, each navigating to `/notes/[id]`. Remove the per-row Edit disclosure and
per-row Delete button; keep the existing tag filter chips.

**Acceptance criteria:**
- [ ] No capture textarea on `/`.
- [ ] Rows show title, snippet, and date; tapping a row opens its editor.
- [ ] No Edit disclosure or per-row Delete button remains.
- [ ] "+" navigates to `/notes/new`.
- [ ] Tag filter chips still filter via `?tag=`.

**Verification:**
- [ ] Manual: tap through the list; confirm filter still works.
- [ ] `npm run build` succeeds.

**Dependencies:** Task 2
**Files:** `apps/web/app/page.tsx`, `apps/web/app/note-list.tsx`, `apps/web/app/globals.css`
**Scope:** Medium

---

## Task 4: Create a new note (`/notes/new` → POST → redirect to its route)

**Description:** Add route `app/notes/new/page.tsx` rendering the editor in create mode. No DB
row is created until the first meaningful input; the first save `POST`s via `createNote`, then
`router.replace`s to `/notes/[id]`. Leaving without typing creates nothing.

**Acceptance criteria:**
- [ ] Opening `/notes/new` creates no row.
- [ ] Typing then saving creates exactly one note and replaces the URL with `/notes/[id]`.
- [ ] Back gesture and refresh after creation behave correctly.
- [ ] Empty/whitespace-only body is not saved.

**Verification:**
- [ ] Manual: create a note from scratch; confirm list shows one new row.
- [ ] `npm run build` succeeds.

**Dependencies:** Task 2
**Files:** `apps/web/app/notes/new/page.tsx`, `apps/web/app/note-editor.tsx`, `apps/web/app/actions.ts`, `apps/web/lib/api.ts`
**Scope:** Medium

---

## Task 5: Delete a note from the editor

**Description:** Add a low-emphasis delete control to `note-editor.tsx` that calls the
existing `removeNote` Server Action and returns to `/`. Remove `removeNote` usage from the
list (already dropped in Task 3).

**Acceptance criteria:**
- [ ] Delete removes the note and returns to the list.
- [ ] The deleted note no longer appears in the list.
- [ ] No confirmation dialog is required (single-user, low stakes).

**Verification:**
- [ ] Manual: delete a note; confirm it is gone after reload.
- [ ] `npm run build` succeeds.

**Dependencies:** Task 2
**Files:** `apps/web/app/note-editor.tsx`, `apps/web/app/actions.ts`
**Scope:** Small

---

## Task 6: Inline `#tags` + retained legacy tag chips

**Description:** Parse inline `#tag` tokens from the body on save
(`/#([^\s#]+)/g`, trim, dedupe case-insensitively, max 50 chars) and write them through the
existing `tags[]`. Display stored tags absent inline as low-emphasis removable chips; saved
tags = inline hashtags ∪ retained chips. Parse on save only, never per keystroke.

**Acceptance criteria:**
- [ ] Inline `#work` in the body becomes a `work` tag on save.
- [ ] Duplicate/mixed-case inline tags dedupe to one tag.
- [ ] A stored tag with no inline token appears as a removable chip and is retained on save.
- [ ] Removing a chip drops that tag on the next save.
- [ ] Typing a partial `#` does not create a tag until save.

**Verification:**
- [ ] Manual: create tags inline, confirm the tag filter lists them; test legacy retention.
- [ ] `npm run lint` passes.

**Dependencies:** Task 2
**Files:** `apps/web/app/note-editor.tsx`, `apps/web/app/actions.ts`
**Scope:** Medium

---

## Checkpoint: Core Editing
- [ ] Tap → type → autosave → Done → list reflects title/snippet works end to end
- [ ] Create and delete work without a page reload
- [ ] Both themes render correctly
- [ ] Review before Phase 3

---

## Task 7: Debounced search field (`?q=`, server round trip)

**Description:** Add `search-box.tsx` client input under the home header. Typing debounces
300ms, then updates `?q=` (via `router.replace`), causing the Server Component to re-render
from `GET /api/notes?q=`. Empty input clears `?q=`. No Search button. Preserve `?tag=` when
composing the URL.

**Acceptance criteria:**
- [ ] Typing filters the list after a debounced server round trip.
- [ ] Clearing the field restores all notes.
- [ ] Tag filter and search compose correctly.
- [ ] No Search button; no new API surface.

**Verification:**
- [ ] Manual: search a known substring; confirm correct subset and clearing.
- [ ] `npm run build` succeeds.

**Dependencies:** Task 3
**Files:** `apps/web/app/search-box.tsx`, `apps/web/app/page.tsx`
**Scope:** Medium

---

## Task 8: Keepalive flush on navigation + BFF route

**Description:** Add `app/api/notes/[id]/flush/route.ts` (PATCH) that injects `API_TOKEN` and
calls the API. In `note-editor.tsx`, on `pagehide` / `visibilitychange=hidden` flush a pending
save via `fetch(..., { keepalive: true })` so an edit survives reload, back gesture, or route
change.

**Acceptance criteria:**
- [ ] Editing then immediately navigating away does not lose the last keystrokes.
- [ ] The flush route requires no token from the browser and is server-side only.
- [ ] No pending save when there is nothing to flush (no spurious request).
- [ ] `keepalive` stays within the 64KB cap for a max-length body.

**Verification:**
- [ ] Manual: type, immediately go back, reopen; content is present.
- [ ] `npm run build` succeeds.

**Dependencies:** Task 2
**Files:** `apps/web/app/api/notes/[id]/flush/route.ts`, `apps/web/app/note-editor.tsx`, `apps/web/lib/api.ts`
**Scope:** Medium

---

## Task 9: Browser verification (playwright-cli, scratch DB) + checks

**Description:** Run scripted browser checks against `npm run dev` (scratch DB) at a phone
viewport covering the full spec: tap-to-open, immediate typing, autosave status, Done, delete,
search, tag filter, create, theme states, and refresh persistence. Run `npm test` and
`npm run lint`. Confirm `life.db` mtime is unchanged.

**Acceptance criteria:**
- [ ] All spec success criteria 1–11 confirmed with evidence.
- [ ] `npm test` passes (API e2e unchanged).
- [ ] `npm run lint` passes for all workspaces.
- [ ] `apps/api/data/life.db` mtime unchanged after the session.

**Verification:**
- [ ] `npm test`, `npm run lint`.
- [ ] `playwright-cli` snapshots/screenshots for each flow.

**Dependencies:** Tasks 1–8
**Files:** none (verification only; scratch DB artifacts)
**Scope:** Medium

---

## Checkpoint: Complete
- [ ] All 11 spec success criteria met
- [ ] `npm test` / `npm run lint` green
- [ ] `life.db` untouched by a dev session
- [ ] Ready for review / commit
