# Implementation Plan: Notes UI/UX — Editing & Search

Spec: `docs/specs/SPEC-notes-ui.md`
Intent: `docs/intent/personal-life-api.md`
Branch: `feat/notes-ui-redesign`

## Overview

Redesign the notes UI so editing and search feel like Apple Notes: tap a note → full-screen
editor → type immediately with silent autosave (plus Done), inline `#tags`, and a debounced
server-side search field. Adds an OS-default light/dark theme with a manual override. No API,
data-model, or dependency changes. Vertical slices: theme foundation → open/edit an existing
note → create/delete → inline tags → search → keepalive durability → browser verification.

## Architecture Decisions

- Full-screen editor is a real route (`/notes/[id]`, `/notes/new`), so the phone back gesture
  and refresh behave correctly. The inline `<details>` disclosure is removed.
- Search and tag filter remain URL-driven (`?q=`, `?tag=`) read by the existing Server
  Component; the search input is the only new client state and debounces 300ms before pushing
  the URL. No new data path — reuses `listNotes(tag, q)`.
- Autosave is a client debounce (400ms) calling the existing `updateNote` Server Action;
  `actions.ts` is reused, not duplicated.
- Tags are parsed from the body on save and written through the existing `tags[]`; stored
  tags absent inline are retained as removable chips so nothing is silently lost.
- A pending save survives navigation via `fetch(..., { keepalive: true })` on `pagehide` to a
  new BFF route (`app/api/notes/[id]/flush/route.ts`) that injects `API_TOKEN`. Server
  Actions cannot outlive navigation.
- Theme tokens live in `globals.css`; a pre-paint inline script in `layout.tsx` applies a
  persisted choice without a flash. Default = System (OS `prefers-color-scheme`).
- Dev always targets `data/scratch.db` via the `apps/api` `dev` script; `start` uses `.env`.

## Task List

Tracked in `tasks/todo-notes-ui.md`. Ordered by dependency.

### Phase 1: Theme foundation
- [x] Task 1: Light/dark tokens + System/Light/Dark toggle

### Checkpoint: Theme
- [x] App renders in both schemes; forced choice persists without flash

### Phase 2: Core editing (vertical slice)
- [x] Task 2: Open an existing note in a full-screen editor with autosave + Done
- [x] Task 3: Home list restyle + tap navigation + "+"; remove capture box
- [x] Task 4: Create a new note (`/notes/new` → POST → redirect to its route)
- [x] Task 5: Delete a note from the editor
- [x] Task 6: Inline `#tags` + retained legacy tag chips

### Checkpoint: Core Editing
- [x] Tap → type → autosave → Done → list reflects title/snippet works end to end
- [x] Create and delete work without a page reload

### Phase 3: Search + durability
- [x] Task 7: Debounced search field (`?q=`, server round trip)
- [x] Task 8: Keepalive flush on navigation + BFF route

### Checkpoint: Features
- [x] Search filters the list; clearing restores it
- [x] Editing then immediately navigating away does not lose the last keystrokes

### Phase 4: Verification
- [x] Task 9: Browser verification (playwright-cli, scratch DB) + `npm test` / `npm run lint`

### Checkpoint: Complete
- [x] All 11 spec success criteria met
- [x] `life.db` untouched by a dev session

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Next.js 15 async `params`/`searchParams` misuse in new routes | Med | Await them as `page.tsx` already does; verify build |
| Theme flash of wrong palette on load | Low | Inline pre-paint script sets `data-theme` from `localStorage` |
| Pending autosave lost on back gesture within debounce | Med | `keepalive` flush route on `pagehide`/`hidden` |
| Tag parsing accidentally captures partial `#` while typing | Low | Parse only on save, never per keystroke |
| Removing the capture box surprises capture flow | Low | Accepted in spec; "+" → immediate full-screen type |
| Autosave races (out-of-order PATCH responses) | Low | Single in-flight save at a time; latest body wins on flush |
| Accidental use of real notes DB during dev | High | `dev` script forces `DB_PATH=data/scratch.db`; verify `life.db` mtime |
| `keepalive` body limit (64KB) exceeded | Low | Note body max is 20KB; within cap |

## Open Questions

None — all spec open questions resolved 2026-09-18.

## Definition of Done

- Spec success criteria 1–11 all met.
- `npm test` passes the existing API e2e path (unchanged).
- `npm run lint` passes for all workspaces.
- Browser verification completed on the scratch DB, phone viewport.
- Real `life.db` mtime unchanged after a dev session.
