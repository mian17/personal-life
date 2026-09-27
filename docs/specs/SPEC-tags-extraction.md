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
  then passes ids. Same user experience, new contract.
- `note_tag` stays in the note DB — association only, id values unchanged (M2).
- `GET /api/notes/tags` → `[{tagId, count}]` (ids + usage counts; names come from
  registry resolve, done by the app). This replaces today's name-returning shape.
- Tag filtering in listings filters over `note_tag` by `tagId` — still metadata-only
  SQL per `SPEC-notes-at-rest` search rules; decrypt-then-match content filtering is
  unchanged.
- Lazy prune (kernel `TagRef` semantics): ids unknown to the registry are omitted
  from DTOs and their association rows pruned opportunistically on writes. Note
  content is never deleted.
- Cache (`## Cache Rules` compliance): the `note:tags` cached shape becomes the
  used-`tagId`+count rows (metadata — ids and counts, no names). Ciphertext-only
  rules continue to apply to `note.body`.

## Migration script (human-run; agents never execute it against real data)

`apps/tags-service/scripts/import-tags.ts` → `npm run import-tags -w @life/tags-service`
(the receiving side owns import; opening both DBs directly is the `backfill-owner`
precedent).

- Inputs: `NOTE_DB_PATH` (read), `TAGS_DB_PATH` (write), `NOTE_MASTER_KEY` (decrypt
  with note-service DEKs), `TAGS_MASTER_KEY` (encrypt under registry DEKs).
- Id-preserving: rows copied with their existing integer ids; re-encrypted under the
  registry's per-owner DEKs (`_legacy_` sentinel filing for NULL-owner rows, per
  `SPEC-notes-backfill`). Plaintext exists only in flight — never at rest.
- Idempotent: an id already present is skipped (byte-identical re-runs); batches are
  transactional; a poisoned row aborts with its id and a non-zero exit; `--dry-run`
  reports counts and writes nothing.
- Report format mirrors the backfill scripts: `import-tags [plan|apply]: imported=N skipped=M keysCreated=K errors=0`.

## Deploy Checklist (human-run)

1. Stop the stack (`docker compose down`).
2. Backup both DB files (note `life.db` + new `tags.db`).
3. `NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> npm run import-tags -w @life/tags-service -- --dry-run` → review counts.
4. Same without `--dry-run` (apply).
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

1. Import: fixture note-DB tag rows → apply → registry rows decrypt to the original
   names with ids preserved; `note_tag` values untouched.
2. Idempotence: second apply skips everything; ciphertext byte-identical.
3. `--dry-run` purity (DB bytes unchanged) + count parity with apply.
4. `_legacy_` NULL-owner rows round-trip.
5. Poisoned row → batch abort, row id surfaced, non-zero exit.
6. note-service TagRef behavior: attach/detach by id, unknown-id pruning, tag filter
   by id, `[{tagId, count}]` shape.
7. Note round-trip with TagRefs: create note with `tagIds` → DTO shows them; names
   resolved by the app from the registry.

## Boundaries

- Always: migration is id-preserving + idempotent; dry-run before apply.
- Ask first: any change to the note create/update DTO shapes (consumer contract).
- Never: agents run the migration against `apps/*/data/**` (hard line); migration at
  boot or in tests against real data; keep duplicate name storage in note-service.

## Success Criteria

1. note-service holds zero tag names; its suites prove TagRef behavior.
2. The migration passes all seven cases and runs verbatim from the checklist.
3. The `/notes` app shows the same tags as before the cut-over (verified by the human
   at deploy, per the checklist).
