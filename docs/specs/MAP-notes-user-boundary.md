# Capability Map: note-service per-user boundary

Traces to: `docs/intent/notes-user-boundary.md` (confirmed 2026-09-26, explicit yes).

| Module id | Responsibility | Depends on |
|---|---|---|
| `note-ownership` | Identity seam (guard → request principal), `ownerSub` persistence on `note` + `tag`, owner-scoped queries, 404 semantics, dev principal | — |
| `note-cache-scope` | Per-user cache keys + per-user generation counter | `note-ownership` |
| `owner-backfill` | Timestamped verified `life.db` backup + idempotent oldest-user backfill (human-run script) | `note-ownership` |

Build order: `note-ownership` → `note-cache-scope`, `owner-backfill` (the latter two are
parallel-safe once the seam and columns exist).

Module specs: `docs/specs/SPEC-note-ownership.md`, `docs/specs/SPEC-note-cache-scope.md`,
`docs/specs/SPEC-owner-backfill.md`.

Chapter-close duty (plan/todo): close the drift this chapter creates in
`SPEC-notes.md` ("No authorization" paragraph) and `SPEC-note-cache.md` (key shapes).

No API surface change (`packages/shared` DTOs byte-identical), no `apps/app` change, no
IdP change. The whole chapter lives in `apps/note-service` + its scripts/tests.
