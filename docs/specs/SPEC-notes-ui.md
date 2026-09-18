# Spec: Notes UI/UX — Editing & Search

Date: 2026-09-18
Status: Draft — pending human review
Module id: `notes-ui`
Traces to intent: `docs/intent/personal-life-api.md`
Design source: `docs/superpowers/specs/2026-09-14-personal-life-api-notes-design.md`

## Objective

Redesign the notes UI/UX so that editing a note and searching notes feel like Apple Notes —
enough that the user sticks with the app for daily use. This is a UI/UX pass only: the
existing API, data model, and stack are unchanged.

Confirmed intent (from interview, 2026-09-18):

- **Outcome:** Apple-Notes-like editing and search, no new note features.
- **User:** The user alone, phone-first, over Tailscale.
- **Why now:** The app works, but form-like editing (`Edit` disclosure + `Save changes`)
  and the absence of search UX will not earn long-term daily use.
- **Success:** Tap a note → full screen → type immediately → silent autosave (plus an
  explicit save affordance). List shows title/snippet/date. Search is a live field with a
  debounced server round trip. Tags recede into inline `#tag` text.
- **Constraint:** UI/UX only. No new dependencies. Keep the stack and data model.
- **Out of scope:** folders, checklists, images, rich text/formatting, instant
  client-side search, offline, multi-user, any change to the API surface, and any visual
  restyle beyond the theme tokens (layout and components are unchanged).

Success: a note can be opened, edited, and autosaved from a phone in a single tap; a text
query filters the list via the existing `q=` parameter; no Save button is required to keep
work.

## Tech Stack

No new dependencies. Existing stack only:

- Next.js 15 App Router; React Server Components for reads, Server Actions for writes.
- React 19 client components for the editor and search input.
- Existing NestJS REST API via the server-side BFF (`apps/web/lib/api.ts`).
- TypeScript strict from `packages/shared`.

## Commands

```
Install:       npm install
Dev:           npm run dev        # API uses DB_PATH=data/scratch.db (apps/api dev script); web :3000
Dev real DB:   npm run start      # API loads apps/api/.env (real life.db); web :3000
Build:         npm run build
Test:          npm test           # API e2e only
Lint:          npm run lint       # tsc --noEmit per workspace
Browser check: playwright-cli open http://127.0.0.1:3000
```

`npm run dev` must never open the real `apps/api/data/life.db`. This is guaranteed by the
`dev` script in `apps/api/package.json` (`DB_PATH=data/scratch.db`), which overrides `.env`
because `process.loadEnvFile` does not replace an already-set env var.

## Project Structure

```
apps/web/app/
  page.tsx            Home: search + tag filter + list (Server Component)
  notes/
    new/page.tsx      New-note editor route (no DB row until first save)
    [id]/page.tsx     Existing-note editor route
  note-editor.tsx     Full-screen client editor (autosave, save)
  note-list.tsx       List rows (title/snippet/date), tap → editor
  search-box.tsx      Client search input; debounced ?q= update
  theme-toggle.tsx    Client System/Light/Dark control; persists to localStorage
  actions.ts          Server Actions: create, update, delete (reused)
  api/notes/[id]/flush/route.ts  BFF PATCH for keepalive flush on pagehide
apps/web/lib/api.ts   Add getNote(id); existing listNotes(tag, q) reused
apps/web/app/globals.css  Restyle for full-screen editor + list rows
```

## Code Style

Client editor component signature and save call, following existing conventions:

```tsx
'use client';

export function NoteEditor({ note }: { note?: Note }) {
  const [body, setBody] = useState(note?.body ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // debounce 400ms → saveNote(id, body); flush on blur, on Save, and on tab hide
}
```

- No comments unless a non-obvious tradeoff needs explaining.
- Server Actions stay in `actions.ts`; components never call the API directly.
- No `any` at module boundaries; reuse `Note`, `CreateNoteInput`, `UpdateNoteInput` from
  `@life/shared`.

## Data Model

Unchanged. No migrations, no new columns, no API changes.

```
note(id, body, created_at, updated_at)
tag(id, name unique)
note_tag(note_id, tag_id)
```

Existing endpoints reused as-is: `POST /api/notes`, `GET /api/notes?tag=&q=`,
`GET /api/notes/:id`, `PATCH /api/notes/:id`, `DELETE /api/notes/:id`, `GET /api/tags`.

## UX Specification

### Home (`/`)

- Header: "Notes". No capture textarea — removed.
- Search field directly under the header. Typing debounces 300ms, then updates `?q=` and
  the Server Component re-renders the list from `GET /api/notes?q=`. Empty input clears the
  param. No Search button.
- Tag filter chips stay on the same pattern as today (`?tag=`), unchanged in behavior.
- List rows: title = first line of body (bold, single line, ellipsis); snippet = remainder
  (muted, up to 2 lines); date on the right. No "Edit" disclosure; each row has its own
  Delete control at the right.
- Tapping a row navigates to `/notes/[id]`.
- A "+" control navigates to `/notes/new`. It is a floating action button fixed to the
  bottom-right of the viewport.

### Editor (`/notes/new`, `/notes/[id]`)

- Full-screen route, not an inline disclosure. The phone back gesture returns to the list.
- No title field: the first line of the body is the title.
- One textarea, full height, autofocused. Typing begins immediately on open.
- **Autosave:** 400ms trailing debounce after typing stops → `PATCH`. Status indicator:
  `Saving…` / `Saved` / `Couldn't save`. Also flush on blur, on the Save control, and when
  the tab becomes hidden.
- **Keepalive flush:** Server Actions cannot outlive navigation, so a pending save is
  flushed on `pagehide` / `visibilitychange=hidden` via
  `fetch(url, { method: 'PATCH', keepalive: true })` to a small BFF route handler that
  injects `API_TOKEN` and calls the API. This is the Google-Docs-style equivalent of
  streaming unacked edits — it survives reload, back gesture, and route change. Keepalive's
  64KB body cap is safe against the 20KB note max. An optional `localStorage` draft mirror
  (recovered on mount) can cover the OS-kills-the-PWA case where no `pagehide` fires; not
  included in v1 unless requested.
- **Explicit save:** a Save control on the left of the toolbar flushes any pending save, then
  returns to `/`.
- **Delete:** deletion lives only on the home list rows; the editor has no delete control.
- **Tags:** tags are edited inline as `#tag` tokens in the body. On save, tags are parsed
  from the body (`/#([^\s#]+)/g`, trimmed, deduped case-insensitively, max 50 chars each)
  and written through the existing `tags` array.
  - Compatibility (approved): tags already stored on a note but not present inline are
    shown as low-emphasis removable chips in the editor so they are not silently lost;
    saved tags = inline hashtags ∪ retained chips. New notes are inline-only.

### New-note creation

- `/notes/new` renders an empty editor. No DB row is created until the first meaningful
  input; the first save `POST`s, then `router.replace`s to `/notes/[id]` so the back gesture
  and refresh behave correctly. Leaving without typing creates nothing.

### Theming (light + dark + manual override)

- Light and dark are driven by a theme token set in `globals.css`: `:root` holds the dark
  tokens; `:root[data-theme='light']` and
  `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` provide light.
- A `theme-toggle.tsx` client control cycles **System → Light → Dark** and persists the
  choice to `localStorage` under `theme`. `System` (the default) means no `data-theme`
  attribute, so the OS `prefers-color-scheme` wins — matching Apple Notes' default.
- An inline `<script>` in `layout.tsx` runs before paint and sets
  `documentElement.dataset.theme` from `localStorage`, preventing a flash of the wrong theme
  on load. It is static and inline (no dependency, no `next/script`).
- The toggle exposes its state with `aria-label` and `aria-pressed`; each press is a normal
  button activation reachable by keyboard.
- `color-scheme: light dark` is set so native controls (textarea, scrollbars, caret) match;
  `viewport.themeColor` gains a light/dark pair.
- This is a token-level restyle shared by both themes; no layout or component change.

## Testing Strategy

- **API:** unchanged — the existing Jest + supertest e2e (`apps/api/test/notes.e2e-spec.ts`)
  must stay green. No new API tests; the API is untouched.
- **Web:** no new automated UI test in this pass. Verification is manual + scripted browser
  checks with `playwright-cli` against the **scratch DB**, covering: tap-to-open, immediate
  typing, autosave status, explicit save, delete, search filtering, tag filter, and a
  refresh-to-confirm persistence check.
- Web verification must never load or mutate the real `life.db`.

## Boundaries

- **Always:** run `npm test` and `npm run lint` before commits; keep the token server-side;
  develop against the scratch DB; verify the editor at a phone viewport.
- **Ask first:** adding a dependency; changing the data model or API surface; changing
  auth/middleware; anything that touches the real `life.db`.
- **Never:** commit secrets; expose the API beyond loopback; open or mutate the real notes
  DB during development; remove the failing test to make a build pass.

## Success Criteria

1. Tapping a note opens `/notes/[id]` full-screen with the cursor in the body; typing starts
   with no extra tap.
2. Editing a note produces no explicit Save action and the change persists across a reload.
3. Pausing typing shows `Saving…` then `Saved` within ~1s on localhost; the list reflects
   the new title/snippet after returning.
4. The Save control flushes the pending edit and returns to the list.
5. Deleting from a home list row removes the note; the list no longer shows it.
6. Typing in the search field filters the list to matching notes after a debounced server
   round trip; clearing it restores all notes.
7. Tag filtering via `?tag=` still works and the existing tags are never silently dropped
   on edit.
8. The list shows title (first line), snippet, and date per row; no Edit disclosure, and each
   row has a Delete control at the right.
9. The app renders correctly in both light and dark schemes, and the theme control cycles
   System → Light → Dark; a forced choice persists across reload with no flash of the wrong
   theme, and System follows the OS.
10. `npm test` and `npm run lint` pass.
11. `npm run dev` uses `data/scratch.db`; `life.db` mtime is unchanged after a dev session.

## Open Questions

Resolved 2026-09-18:

1. **Legacy tag handling.** Removable chips for tags not present inline; saved tags = inline
   hashtags ∪ retained chips. ✓
2. **Back-gesture / navigation flush.** BFF route handler + `keepalive` on
   `pagehide` / `visibilitychange=hidden`, so a pending save survives navigation. Optional
   `localStorage` draft mirror deferred, not in v1. ✓
3. **Accent/visual direction.** Light mode added. Default follows the OS (Apple Notes-like),
   with a manual System/Light/Dark override persisted in `localStorage`. No other visual
   restyle. ✓

None outstanding.
