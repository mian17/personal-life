# Spec: `note-cache` — read-through cache over the notes DB

Traces to: `docs/specs/MAP-redis.md`, `docs/intent/redis-shared-state.md`.

## Objective

`apps/note-service` gets its own read-through cache so note reads (the hot path — list,
open, search/filter, trash, tags) are served from cache when scaled to N replicas. The
DB stays the source of truth; cache loss degrades to DB reads and is never wrong.

## Contract (the seam)

- Cached reads (all in `NotesService`): `findAll(opts)`, `findTrash(opts)`,
  `findOne(id)`, `listTags()`. Keys embed the request shape:
  `note:v<gen>:list:<hash(opts)>`, `note:v<gen>:trash:<hash(opts)>`,
  `note:v<gen>:one:<id>`, `note:v<gen>:tags`. TTL 60s.
- **Invalidation = generation bump.** Every write (`create`, `update`, `remove`,
  `restore`, `removePermanent`, `emptyTrash`) runs `INCR note:gen` **after** its DB
  mutation; stale keys are unreachable (they hold the old generation in the key) and age
  out via TTL. One atomic op per write; no `KEYS`/`SCAN`, no per-query invalidation
  bookkeeping. **Why after, not before (review finding 2026-09-25):** a bump-first
  ordering leaves a stale window — a read landing between the bump and the mutation
  would cache pre-mutation state under the NEW generation and hold it for the TTL (the
  stale-guard only covers bumps that land during the query). Bump-after closes it: any
  entry that can hold pre-mutation state is born under the old generation and dies on
  the bump.
- Read-through: miss → DB → populate under the *current* generation (re-read `gen`
  after the query and only populate if unchanged — a write during the query must not be
  masked by a freshly-populated stale value).
- Fail-open: any Redis error → DB path (correct, degraded). No response-shape change.
- Selection once at module init: `REDIS_URL` set → cached; unset → today's direct DB.
  Dev/e2e unchanged.

## Security posture

Note bodies are user data. Same exposure boundary as `life.db`: internal-only Redis,
no published host port, **no persistence** (cache containers run without AOF/volumes —
note content must not be written to a second disk), 60s TTL ceiling. The data hard line
still holds: `apps/note-service/data/life.db` is never modified by this module.

## Tech Stack

`redis` (node-redis — cluster-ready), NestJS wiring inside the existing `NotesModule`.

## Commands

```
Unit:      npm run test -w apps/note-service
Typecheck: npm run lint
Integration: none built (optional future TEST_REDIS_URL-gated describe) — coverage is the fake-client suite (hit / invalidation ordering / stale-guard / fail-open); the TEST_REDIS_URL seam lives in apps/app's hop proof.
```

## Project Structure

```
apps/note-service/src/notes/notes.service.ts     → read-through + gen-bump at writes
apps/note-service/src/notes/notes-cache.ts       → cache helper (gen keys, getThrough, bump)
apps/note-service/test/notes-cache.e2e-spec.ts   → hit / invalidate / gen-stale-guard / fail-open
```

## Code Style

```ts
async findOne(id: string): Promise<NoteDto> {
  return this.cache.getThrough(`note:one:${id}`, () => this.notes.findOneByOrFail({ id }));
}
// Every write ENDS with await this.cache.bumpGeneration(); // one INCR invalidates all reads
```

Controllers unchanged — the cache lives inside the service layer.

## Testing Strategy

- Hit: second identical `findAll` does not touch the repository (spy).
- Invalidate: any write → next read reflects the write (parametrized over all six writes).
- Stale-guard: a write landing *during* a slow query does not get masked by the populate.
- Fail-open: injected failing client → full CRUD suite passes unchanged.
- Regression: note suite (25) green with `REDIS_URL` unset.

## Boundaries

- **Always:** fail open; 60s TTL ceiling; gen-bump after any write's DB mutation.
- **Ask first:** caching anything beyond the four read methods; changing `NoteDto` shape.
- **Never:** enable persistence on the cache Redis; publish the Redis port; touch
  `apps/note-service/data/**` (life.db md5 `31767e4d…` is a hard line); cache auth/JWT
  material.

## Success Criteria

1. Second identical read is a cache hit (unit-proven).
2. Each of the six writes invalidates (parametrized unit-proven).
3. Stale-guard proven (populate-after-write-during-query case).
4. Cache down → CRUD fully correct (fail-open e2e).
5. Note suite green with `REDIS_URL` unset; `life.db` checksum unchanged.

## Open Questions

None.
