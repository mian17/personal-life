---
type: "Reference"
title: "Notes lifecycle"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-0d8b2ba21ac2a0ecea9055df
    resource: repo://apps/app/proxy.ts
  - id: openwiki-source-1e3fcdc716f32667daab9339
    resource: repo://apps/note-service/src/notes/content-match.ts
  - id: openwiki-source-814dc76e3f0c8b5ef69c4558
    resource: repo://apps/note-service/src/notes/note.entity.ts
  - id: openwiki-source-7b89a209c1ecc4b1f6088653
    resource: repo://apps/note-service/src/notes/notes-batch.controller.ts
  - id: openwiki-source-01e5e8cfab49c679801fbc82
    resource: repo://apps/note-service/src/notes/notes.controller.ts
  - id: openwiki-source-cff9f3cd43de542831333a4b
    resource: repo://apps/note-service/src/notes/notes.service.ts
  - id: openwiki-source-aaa203a9bf25ac19f43fe44b
    resource: repo://packages/cache/src/index.ts
  - id: openwiki-source-e2eb94b060f24aab62e34387
    resource: repo://packages/service-kit/src/paging.ts
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Notes lifecycle

Domain #1. A note is encrypted content owned by one user, filtered and paged in
memory, cached as ciphertext. This page traces the flow; the invariants behind
it are [Data layer](../architecture/data-layer.md) and
[Crypto at rest](../architecture/crypto-at-rest.md) — not repeated here.

## The surface

`note-service` (`apps/note-service/src/notes/`) exposes
`api/notes` — create, list, get one, update, soft delete → trash, list trash,
restore, permanent delete, empty trash — plus batch variants
(`api/notes:batchCreate` / `:batchUpdate` / `:batchDelete`, routed with escaped
colons so Nest matches the literal path) and `api/tags` for the tag registry.
Tags live in a join entity (`note-tag.entity.ts`); the tag list endpoint feeds
both notes and todos.

The row (`note.entity.ts`) is minimal: `title`, `body`, trash/position columns,
and `contentUpdatedAt` — bumped **only by body writes**, never by title or
metadata edits, so "content changed" stays a meaningful signal (the meal editor
and sync paths rely on it).

## A create, end to end

1. The BFF (`apps/app`) is the only API caller: it forwards the user's bearer
   token; `AuthGuard` verifies it and installs `sub`.
2. The service encrypts `title`/`body` under the owner's DEK (`enc.v1.`
   envelopes, AAD-bound) and writes the row in its own SQLite store.
3. After the DB mutation succeeds, `bumpGeneration(sub)` invalidates the owner's
   cached reads. A thrown insert never bumps.

## A list, end to end

1. `getThrough(sub, rest, loader)` consults the generation-scoped cache entry
   for the fetch shape (all rows / one row — **no** filter or pagination in the
   key).
2. On a miss, the loader reads the serialized encrypted rows from SQLite and
   the cache stores them as persisted (ciphertext).
3. **The decrypt boundary is here:** rows are decrypted in the request path,
   then filtering (`q` via the LIKE-parity `likeMatch` in `@life/shared` —
   in-memory, post-decrypt; `content-match.ts` is a re-export shim kept for
   call-site compatibility) and paging (`@life/service-kit`'s cursor seam,
   caller-supplied order) run over plaintext that never leaves the request.

## Trash, restore, batch

Trash is a soft delete with a `deletedAt`-style state: listing excludes trashed
rows, `restore` clears it, `permanent` removes the row, `empty trash` is the
bulk form. Batch operations run one transaction with one generation bump (the
batch kernel in [Service kernel](../architecture/service-kernel.md)); per-item
results come back in submission order.

## Audit

Write paths emit audit entries through the shared audit listener
(`@life/service-kit/src/audit/`), so every service logs the same shape without
each reimplementing it. The audit surface is queried the same way as any list —
decrypt first, filter in memory.

## The BFF and the UI

The Next.js app renders notes through `@life/ui`
([Shared UI contract](../architecture/ui-contract.md)); its server routes are
the only thing that talks to `note-service`. No browser ever calls a domain
service directly — which is also what makes the access/identity gate model
([Identity and access](identity-and-access.md)) sufficient: one front door.

## See also

- [Todos and the transactional outbox](todos-and-outbox.md) — the write-side
  pattern for cross-service effects; notes stay single-service.
- [Testing strategy](../testing/strategy.md) — `crypto-roundtrip.test.ts`,
  `content-match.test.ts` and the note-service e2e specs.
