# Intent: notes sort by contentUpdatedAt

- Outcome: Notes list orders by `contentUpdatedAt DESC` — a new column bumped only when a note's body changes — replacing `createdAt DESC` order. Row timestamp stays `createdAt`.
- User: The note owner, on the notes list, hunting for the note they just wrote in.
- Why now: Birth-date order buries recently edited old notes and the user has to scroll to find them.
- Success: Edit a body → note is top row; retag, trash, or restore → position unchanged.
- Constraint: `contentUpdatedAt` is written only by body edits; `updatedAt`/`version` semantics untouched; cursor pagination correct on the new key; legacy rows backfilled to `createdAt` so deploy doesn't reshuffle the list.
- Out of scope: No "last opened" tracking, no sort toggle, trash order (`deletedAt DESC`) unchanged, no display of edit times.

## Confirmation
Confirmed: yes — the user explicitly answered "yes" to the six-line restate above (2026-10-16) and chose "go with 1" (full spec → plan → implementation pipeline). Approved to proceed.

## Design notes (from the interview)
- Approach: dedicated semantically-narrow timestamp column, one writer (body edit in `NotesService.update()`), one reader (list order + cursor). Rejected: repurposing `updatedAt` with suppressed bumps (silent failure mode), client/cache-side ordering, an edit-history log table, DB triggers.
- Backfill rule: existing rows get `contentUpdatedAt = createdAt` (not `updatedAt` — trash/tag ops bumped that, so it would reshuffle the list at deploy). Deploy is a no-op for list order until a real edit happens.
- `updatedAt` keeps its generic row-timestamp role and `version` remains the optimistic-conflict token (`SPEC-notes-ui.md:113` rejects `updatedAt` as a conflict token).
- Cache row shape (`toCachedNoteRow`) grows one field; the cached-row decoder must tolerate entries missing the field — one test for that.
- The `ALTER TABLE` for existing DBs is a documented, human-run checklist item (hard-lines rule), not agent-run.
