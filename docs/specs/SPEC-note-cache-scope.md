# Spec: `note-cache-scope` — per-user cache keys and generation

Traces to: `docs/specs/MAP-notes-user-boundary.md`, `docs/intent/notes-user-boundary.md`.
Amends `docs/specs/SPEC-note-cache.md` (whose key shapes gain a sub component).

## Objective

The cache respects the ownership boundary: one user's entries are unreachable through
another user's keys, and one user's writes neither invalidate nor populate another
user's entries.

## Contract (the seam)

- Every key embeds the owner sub:
  `note:<sub>:v<gen>:list:<hash(opts)>`, `note:<sub>:v<gen>:trash:<hash(opts)>`,
  `note:<sub>:v<gen>:one:<id>`, `note:<sub>:v<gen>:tags`.
- The generation counter becomes per-user: `note:gen:<sub>` (was global `note:gen`).
- Everything else is unchanged from `SPEC-note-cache.md`: bump **after** each write's DB
  mutation, stale-guard populate-if-generation-unchanged, TTL 60s, fail-open to DB on
  any Redis error, selection once at module init on `REDIS_URL`.
- `NotesCache.key()` / `bumpGeneration()` take `sub`; callers pass the same sub they
  queried with.

## Security posture

Same as `SPEC-note-cache.md`: internal-only Redis, no published port, no persistence.
The sub component makes cross-user key collision impossible; it is not an access
control (the service layer is), it is leak prevention at the cache layer.

## Tech Stack

`redis` (node-redis), existing `NotesCache` helper. No new dependencies.

## Commands

```
Unit:      npm run test -w apps/note-service
Typecheck: npm run lint
```

## Project Structure

```
apps/note-service/src/notes/notes-cache.ts       → keys + gen take sub
apps/note-service/src/notes/notes.service.ts     → passes sub into cache calls
apps/note-service/test/notes-cache.e2e-spec.ts   → key-shape + isolation cases
```

## Code Style

```ts
this.cache.getThrough(sub, `note:one:${id}`, async () => {
  const note = await this.notes.findOneBy({ id, ownerSub: sub });
  if (!note) throw new NotFoundException(); // foreign id and missing id: same 404
  return note;
});
// every write ENDS with await this.cache.bumpGeneration(sub);
```

## Testing Strategy

- Exact key shapes asserted with a sub component (update the existing key-shape tests).
- Isolation: A's write bumps only `note:gen:<a>`; B's already-cached entries survive
  and still serve; B's read never populates a key reachable from A's namespace.
- Ordering/stale-guard/fail-open cases from `SPEC-note-cache.md` stay green (they run
  under one sub and must be unaffected).

## Boundaries

- **Always:** sub in every key; bump-after ordering; fail-open.
- **Ask first:** caching anything beyond the four read methods; changing TTL.
- **Never:** enable Redis persistence; publish the port; share one generation counter
  across users; cache auth/JWT material.

## Success Criteria

1. Key-shape tests green with the sub component.
2. Two-user isolation case green (fake client).
3. Full cache suite green (ordering, stale-guard, fail-open unchanged).
4. Note suite green with `REDIS_URL` unset.

## Open Questions

None.
