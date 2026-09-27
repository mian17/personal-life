# Spec: tags-extraction (note-service becomes a registry consumer)

Module id: `tags-extraction` (see `MAP-todo-ecosystem.md`). Turns note-service's
tag ownership into TagRef associations against `tags-service`, and moves the
existing tag rows out (human-run migration).

## Objective

note-service stops owning tag names. After this module, `tag` rows live only in
`tags-service`; note-service keeps `note_tag` association rows referencing registry
ids, and the app composes names from the registry (MAP M4).

## Behavior changes (note-service)

- Note create/update DTOs: `tags: string[]` → `tagIds: number[]` (`TagRef`). The app
  resolves/creates names via `tags-service` first (`POST /api/tags` create-or-get),
  then passes ids. Same user experience, new contract. (App call-site updates are
  owned by T8.)
- `note_tag` stays in the note DB — association only, id values unchanged (M2).
  After schema surgery (below) it carries **no FK to `tag`**: the referenced
  vocabulary is external, so cross-DB referential integrity is enforced at service
  level (detach semantics), while `noteId` keeps its `ON DELETE CASCADE` FK to `note`.
- `GET /api/tags` (the **existing route path**, shape changed in place) →
  `[{tagId, count}]` (ids + usage counts; names come from registry resolve, done by
  the app). This replaces today's name-returning shape at the same route
  (`apps/note-service/src/notes/tags.controller.ts`).
- Tag filtering in listings filters over `note_tag` by `tagId` — still metadata-only
  SQL per `SPEC-notes-at-rest` search rules; decrypt-then-match content filtering is
  unchanged.
- Detach handling (kernel `TagRef` semantics, no S2S): note-service stores exactly
  the `tagIds` each write carries — updates replace the set, so dangling ids fall
  away on the next edit; the BFF omits unresolvable ids when rendering. Note
  content is never deleted.
- Supersession note: `SPEC-notes-at-rest.md`'s "`note:tags` = serialized ciphertext
  tag rows" cache bullet is superseded here — the cached shape becomes the
  used-`tagId`+count rows.

## Cache Rules (AGENTS.md Contract 2)

- Cached shape: the used-`tagId`+count rows for the owner (`note:tags` key) —
  **metadata-only by design** (ids and counts carry no plaintext, so the
  ciphertext-only assertion scope is content-bearing rows such as `note.body`).
- Content-row cache shapes (`note:list:*`/`note:trash:*`/`note:one:*`) are unchanged
  from `SPEC-notes-at-rest` (serialized ciphertext rows).
- Key composition, generation-counter invalidation, 60s TTL, fail-open: unchanged.

## Migration script (human-run; agents never execute it against real data)

`apps/tags-service/scripts/import-tags.ts` → `npm run import-tags -w @life/tags-service`
(the receiving side owns import; opening both DBs directly is the `backfill-owner`
precedent).

- Inputs: `NOTE_DB_PATH` (read; default `apps/note-service/data/life.db`),
  `TAGS_DB_PATH` (write; default `apps/tags-service/data/tags.db`) — resolved via
  `apps/tags-service/src/keys/db.ts` (T3, mirroring note-service's resolver:
  cwd-independent default, env override wins; a third copy would trigger extraction
  to `@life/shared`, rule of three) — plus `NOTE_MASTER_KEY` (decrypt with
  note-service DEKs) and `TAGS_MASTER_KEY` (encrypt under registry DEKs).
- First action, before any write: a self-verified backup of BOTH DBs (`VACUUM INTO`
  + `PRAGMA quick_check`, the `backfill-owner` precedent). No destructive step runs
  without it; a failed check aborts the script.
- Id-preserving: rows copied with their existing integer ids. Input is dual-read —
  values starting `enc.v1.` are decrypted with note-service DEKs, legacy plaintext
  names (pre-`notes-backfill` rows) pass through as-is — and **every** imported name
  is re-encrypted under the registry's per-owner DEKs (`_legacy_` sentinel filing for
  NULL-owner rows, per `SPEC-notes-backfill`). Plaintext exists only in flight.
- Idempotent: an id already present is skipped (byte-identical re-runs); batches are
  transactional; a poisoned row aborts with its id and a non-zero exit; `--dry-run`
  reports counts and writes nothing.
- Schema surgery (final step, after a fully successful import; `PRAGMA
  foreign_keys = OFF` window + table rebuild, the `backfill-owner` precedent):
  `note_tag` is rebuilt without the FK to `tag` (keep `noteId` FK + PK), then the
  note DB's `tag` table is dropped. Idempotent: absent `tag` table / already-rebuilt
  `note_tag` → skipped.
- Report format mirrors the backfill scripts: `import-tags [plan|apply]: imported=N skipped=M keysCreated=K errors=0`.

## Deploy Checklist (human-run)

1. Stop the stack (`docker compose down`).
2. Backup both DB files (note `life.db` + new `tags.db`).
3. `NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> NOTE_DB_PATH=<life.db> TAGS_DB_PATH=<tags.db> npm run import-tags -w @life/tags-service -- --dry-run` → review counts. (DB-path vars optional — defaults resolve correctly from the repo root.)
4. Same without `--dry-run` (apply; ends with the schema surgery).
5. Boot (`docker compose up -d`) → verify tags render in `/notes`.
6. Rollback = restore both backups + previous image (old code cannot read the new
   arrangement; dual-read does not apply here — M5).

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/tags-service -- test/import-tags.test.ts
           npm run test:unit -w @life/note-service -- test/tag-refs.test.ts
Dry run:   NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> npm run import-tags -w @life/tags-service -- --dry-run
```

## Testing Strategy

Owned here (migration cases):
1. Import: fixture note-DB tag rows → apply → registry rows decrypt to the original
   names with ids preserved; `note_tag` values untouched.
2. Idempotence: second apply skips everything; ciphertext byte-identical.
3. `--dry-run` purity (DB bytes unchanged) + count parity with apply.
4. `_legacy_` NULL-owner rows round-trip.
5. Poisoned row → batch abort, row id surfaced, non-zero exit.
6. Schema surgery: post-apply there is no `tag` table, `note_tag` has no FK to it,
   and inserts into `note_tag` succeed.
7. Legacy plaintext name input (pre-`notes-backfill` rows): imported and stored as
   registry envelopes.
8. Verified backup: `VACUUM INTO` + `quick_check` snapshots exist before any write;
   a failed check aborts.

Owned by T5 (`test/tag-refs.test.ts`, note-service behaviors): attach/detach by id,
unknown-id pruning, tag filter by id, `[{tagId, count}]` shape, note round-trip with
`tagIds`.

## Boundaries

- Always: migration is id-preserving + idempotent; dry-run before apply; backups
  precede the destructive schema-surgery step.
- Ask first: any change to the note create/update DTO shapes (consumer contract).
- Never: agents run the migration against `apps/*/data/**` (hard line); migration at
  boot or in tests against real data; keep duplicate name storage in note-service.

## Success Criteria

1. note-service holds zero tag names; its suites prove TagRef behavior.
2. The migration passes every case in the list above and runs verbatim from the checklist.
3. The `/notes` app shows the same tags as before the cut-over (verified by the human
   at deploy, per the checklist).
