# Intent — Notes Trash & Restore

Date: 2026-09-18
Status: Confirmed by user
Branch: `feat/trash-and-restore`

## Outcome

Deleting a note no longer destroys it. The list's `×` **soft-hides** the note (silently, no
prompt). A `/trash` page lists hidden notes with per-row **Restore** and **Delete forever**
(confirm), plus a bulk **Empty Trash** (confirm). Only those explicit actions erase.

## User

The user alone. Single-user system, mobile-first (phone primary), with an undo window before
permanent loss.

## Why now

`deleteNote` currently performs a hard DB `DELETE`. A mis-tap loses data with no recovery.
Soft-delete is the safety net that makes the existing `×` safe to keep tappable on a phone.

## Success

- A trashed note disappears from the main list, search results, and tag filters.
- Restoring brings the note back at its **original date**, with its **tags intact**.
- Nothing is destroyed unless the user explicitly says so.

## Constraints

- Soft-delete via a `deletedAt` timestamp on the note (null = active).
- No automatic retention/expiry — trash never purges on its own.
- Existing versioning, editor, search, and tag behavior must keep working unchanged.
- Reuse existing header/list/button patterns; all icons via `lucide-react`.

## UX decisions (confirmed)

- Trash entry point: a **Lucide trash icon** in the header, linking to `/trash`. No badge/count.
- List `×`: moves to trash **silently** (no confirmation) — recoverable, so friction belongs
  only on permanent deletes.
- Restore: pure unhide. Original `createdAt` position, tags preserved.
- Permanent delete: per-row **Delete forever** with `confirm()`.
- Bulk: **Empty Trash** with `confirm()`.

## Icon migration (confirmed)

Replace all text/glyph icons with Lucide:

- note list delete `×` → `Trash2`
- editor back `‹` → `ChevronLeft`
- editor tag-chip remove `×` → `X`
- floating new-note `+` → `Plus`
- theme toggle text (System/Light/Dark) → icon-only `Monitor` / `Sun` / `Moon`
- header → new `Trash2` link to `/trash`

## Out of scope

- Automatic expiry or retention policy.
- Bulk restore / multi-select.
- Restoring from within search results.
- Confirmation prompt on the list `×`.
- Any cross-device conflict semantics changes for trashed notes.
