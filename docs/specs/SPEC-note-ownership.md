# Spec: `note-ownership` — per-user ownership of notes (and tags)

Traces to: `docs/specs/MAP-notes-user-boundary.md`, `docs/intent/notes-user-boundary.md`.

## Objective

Every note — and every tag — belongs to exactly one user: the IdP `sub` of the verified
access token. Every query is scoped by it. A token with another `sub` sees an empty list
and cannot touch existing rows. For the single user the boundary is invisible: same API,
same UI, byte-identical DTOs.

## Contract (the seam)

- **Principal seam.** `AuthGuard` stops discarding claims: after `verifyAccessToken`
  succeeds it sets `request.principal = { sub: payload.sub }`. A verified token whose
  `sub` is missing, empty, or not a string is **rejected with 401** — claims without
  identity are unauthenticated here. The `NODE_ENV=development` bypass sets
  `request.principal = { sub: 'dev-user' }` — the constant dev subject is produced
  **only** by the bypass, never by a verified token. A request without a principal
  cannot reach a handler (guard rejects first). Handlers read the sub through a
  `@Principal()` param decorator and pass it explicitly into `NotesService` — no
  ambient/global identity.
- **Persistence.** `note.ownerSub: text` and `tag.ownerSub: text`, both nullable. All
  legacy schema surgery is the backfill script's job (validated on typeorm 0.3.31:
  `synchronize` never drops a legacy single-column inline `UNIQUE(name)` — it is an
  un-droppable `sqlite_autoindex` and gets cloned forward by every rebuild, so a legacy
  `tag` table never converges): the script adds `note.ownerSub` via native
  `ALTER TABLE ADD COLUMN`, and rebuilds `tag` once (backup-covered, before boot) with
  `UNIQUE INDEX "UQ_tag_name_owner"(name, ownerSub)` — the explicit name the entity
  declares (`@Index('UQ_tag_name_owner', ['name','ownerSub'], { unique: true })`), so
  first-boot `synchronize` finds its expectation and does nothing. Every `create`
  stamps `ownerSub = sub`. `NULL` = legacy pre-boundary row: matched by no query,
  visible to nobody, written only by `owner-backfill`.
- **Scoping.** Every `NotesService` method takes `sub` and filters `ownerSub = :sub`:
  `findAll`, `findTrash`, `findOne`, `update`, `remove`, `restore`, `removePermanent`,
  `emptyTrash` (empties only the caller's trash), `listTags` (only the caller's tags —
  `tags.controller.ts` adopts `@Principal()` too). Tag resolution on create/update
  attaches or creates the caller's own tags.
- **404 semantics.** A note that does not exist and a note owned by someone else return
  the same 404 — no existence probing. The service throws `NotFoundException`
  explicitly: TypeORM's `EntityNotFoundError` is **not** mapped to 404 by default Nest
  and would surface as 500. There is no 403 anywhere in the notes API.
- **DTO unchanged.** `Note`/`NotePage` in `packages/shared` keep their exact shape;
  `ownerSub` is internal and never serialized.

## Security posture

Token verification is unchanged (EdDSA, remote JWKS, aud `note-service`). `sub` is
opaque — never parsed, never logged. The dev principal is local-only and dev mode must
not run against the production DB or a production `NODE_ENV` container (the deployed
compose sets `NODE_ENV=production`). Hard lines stand: `apps/note-service/data/life.db`
is never written by agents/tests; no secrets.

## Tech Stack

NestJS (existing `NotesModule`, `AuthGuard`), TypeORM + better-sqlite3, `jose` — all
already in place. No new dependencies.

## Commands

```
Unit:      npm run test -w apps/note-service
Typecheck: npm run lint
```

## Project Structure

```
apps/note-service/src/auth/auth.guard.ts          → sets request.principal (sub-less token → 401)
apps/note-service/src/auth/principal.ts           → AuthenticatedRequest + @Principal()
apps/note-service/src/notes/note.entity.ts        → ownerSub column
apps/note-service/src/notes/tag.entity.ts         → ownerSub column, UNIQUE(name, ownerSub)
apps/note-service/src/notes/notes.controller.ts   → @Principal() → service calls
apps/note-service/src/notes/tags.controller.ts    → @Principal() → listTags(sub)
apps/note-service/src/notes/notes.service.ts      → every method takes sub, filters ownerSub
apps/note-service/test/ownership.e2e-spec.ts      → two-subject isolation suite
```

## Code Style

```ts
async findOne(sub: string, id: string): Promise<NoteDto> {
  const note = await this.notes.findOneBy({ id, ownerSub: sub });
  if (!note) throw new NotFoundException(); // foreign id and missing id: same 404
  return toDto(note);
}
```

## Testing Strategy

Hermetic JWT harness (existing `test/jwt-harness.ts`) signs tokens for two subjects A/B.

- A sees only A's rows; B's list/trash/tags are empty.
- B on A's id: get/patch/delete/restore/permanent → 404, byte-identical to a
  nonexistent id (assert the body/status match exactly).
- `emptyTrash` empties only the caller's trash.
- Tag list and tag resolution are per-user (A's tag names never appear to B).
- A verified token with a missing `sub` → 401.
- Dev-bypass principal is `dev-user` and a dev-mode `create` stamps rows accordingly.
- `NoteDto` has no owner field (shape assertion).
- Regression: the existing note suite stays green (its fixture subject owns its fixtures).

## Boundaries

- **Always:** 404 for foreign and missing ids alike (explicit `NotFoundException`);
  stamp `ownerSub` on every create; scope every query; pass `sub` explicitly (no
  ambient identity); 401 for sub-less verified tokens.
- **Ask first:** exposing owner in any DTO; any cross-user visibility (sharing);
  changing the dev subject; deleting or renaming the `ownerSub` columns.
- **Never:** join to `idp.db` or any cross-DB query; build a user service/RPC; return
  403 (it leaks existence); write `life.db` from tests; run against production data.

## Success Criteria

1. Two-subject isolation suite green (every case in Testing Strategy).
2. A token with an unseen `sub` sees zero rows in list, trash, and tags.
3. Existing note suite green unchanged.
4. `NoteDto` byte-identical (no owner field anywhere in `packages/shared`).

## Open Questions

None.
