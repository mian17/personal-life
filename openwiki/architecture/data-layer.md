---
type: 'Reference'
title: 'Data layer: BE → cache → DB'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-fed7fa55aec41f6ed7c56050
    resource: repo://apps/note-service/src/notes/notes-cache.ts
  - id: openwiki-source-cff9f3cd43de542831333a4b
    resource: repo://apps/note-service/src/notes/notes.service.ts
  - id: openwiki-source-aaa203a9bf25ac19f43fe44b
    resource: repo://packages/cache/src/index.ts
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Data layer: BE → cache → DB

Every domain service that serves owner data is built in exactly three layers:

```
request → BE (service: authz, domain logic, encrypt/decrypt)
        → cache (read-through, Redis)
        → DB (reached only through the cache's loader)
```

The cache is part of the architecture, not an optimization. The generic
implementation is `ReadThroughCache` in `@life/cache`; each service subclasses
or composes it with its own namespace (`note`, `tags`, `todo`, `meal`, …). The
reference adapter is `apps/note-service/src/notes/notes-cache.ts` — it pins the
`note` namespace and keeps the pre-extraction import surface
(`NotesCache`, `NOTES_CACHE`, `createNotesCache`, `generationKey`) so callers did
not move.

## The contract, rule by rule

**The DB sits behind the cache, not beside it.** Read flows go through
`getThrough(sub, rest, loader)`; repository access lives inside the `loader` and
nowhere else. Write flows go BE → DB, then `bumpGeneration(sub)` — the cache is
never the source of truth and never absorbs a write silently.

**Cached values are rows as persisted.** For content-bearing services that means
ciphertext (`enc.v1.` envelopes): the loader returns the serialized DB row, the
same value is returned to the caller and stored in Redis. Decrypt, assemble DTOs,
filter and paginate happen _after_ every cache hit, in the request path only.

**The key reflects the fetch, not the request.**
`<service>:<sub>:v<generation>:<rest>`, with per-owner isolation. Content
filters (`q`, tag filters) and pagination (`cursor`, `limit`) never enter the
key — one entry serves every filter and page variant. The generation counter key
is `<service>:gen:<sub>`; there is no `DEL` on the client surface, because
per-key deletion is unnecessary when a generation bump invalidates every one of
an owner's entries at once (and `DEL` does not travel well through a Redis
cluster).

**Invalidation is a per-owner generation bump on successful writes.** One
`INCR <service>:gen:<sub>` after the DB mutation invalidates everything that
owner has cached. Bump-after is deliberate: bump-before leaves a window where a
read landing between the bump and the mutation caches pre-mutation state under
the new generation for the whole TTL. A mutation that throws never bumps, so the
cache keeps serving a view of a write that did not happen. A batch write bumps
once (the batch kernel owns the transaction and the single bump).

**The stale-guard closes the read race.** `getThrough` captures the generation
_before_ running the loader and re-reads it _after_: if a write bumped the
counter while the DB query was in flight, the fresh query result is already
stale, so it is never written under the new generation. The next read misses and
observes the write.

**TTL is a backstop, not the mechanism.** Entries carry a 60-second expiry
(`CACHE_TTL_SECONDS`) so a missed bump cannot serve stale data forever.

**Fail open, always.** Any cache error — disconnected client, timeout, an
unusable entry (including a legacy plaintext value: `cacheable` refuses it and
it is served from the DB instead) — falls through to the direct loader. The
cache may never cause unavailability, and the fallback path must not write
plaintext. `createNotesCache` connects in the background with
`disableOfflineQueue`, so a briefly-unreachable Redis rejects commands
immediately instead of hanging a read on a queued command.

## Writing a new service's cache

Do not fork `notes-cache.ts`. Subclass `ReadThroughCache` with your namespace and
put the per-service naming in one small adapter (see `meal-service`'s
`entries-cache.ts` and `idp`'s `users-cache.ts` for the pattern). What the
adapter owns: the namespace string, the `rest`-key vocabulary, and the
`cacheable` predicate if some rows must not be cached. What stays in the shared
package: generation mechanics, the stale-guard, TTL, fail-open, and the
ciphertext discipline.

## See also

- [Crypto at rest](crypto-at-rest.md) — the envelope formats the cached rows
  carry.
- [Service kernel](service-kernel.md) — the outbox and shared service
  primitives these layers sit on.
- [Todos and the transactional outbox](../workflows/todos-and-outbox.md) — the
  write-side pattern (transaction + one bump) in a real flow.
