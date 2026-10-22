# 0011 — "Per-service Redis" means a dedicated instance, not a shared one

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

**Summary:** "Per-service cache" means a dedicated instance, not a shared one with namespaced keys; verify ownership, not presence.

- **Date:** 2026-10-01
- **Source:** user question about the tags service and Redis

## Feedback

> "ok one question, why tag has no redis? it was supposed that always include cache
> for all backend services. please save this into lesson learned"

then, correcting my "it already has Redis" answer:

> "no, since tag is a service outside of notes app now, it has to be outside of the
> note service, tag service MUST HAVE ITS OWN REDIS"

## What it corrected

The service *did* have a read-through cache (`apps/tags-service/src/tags/tags-cache.ts`,
consumed at `tags.service.ts:102`), so I answered "tags has Redis" — half right, and
wrong about the thing that mattered. It was wired to the **shared** `redis-note`
instance (`compose.yaml`), the same one note-service uses. The user's "no redis" was
shorthand for "no Redis *of its own*": the cache was not isolated, so tags-service had no
dedicated instance — which the recorded architecture explicitly forbids.

The decision was already written down: `docs/intent/redis-shared-state.md` decision 3 —
*"One Redis instance per service, not shared, not logical-DB-separated."* `MAP-redis.md`
only ever named three modules (`app-state`, `idp-cache`, `note-cache`); when tags and todo
shipped, their caches were pointed at `redis-note` instead of getting their own instance.
So my "the code is fine, only the docs lag" read was wrong: the **compose wiring itself
violated the decision**, and the stale map was the symptom that let it through.

Fix: dedicated `redis-tags` and `redis-todo` instances; `REDIS_URL` re-pointed per
service; `depends_on` and the Redis-section comment updated; specs/README/`.env.example`
corrected to list all five instances.

## The lesson

- **"Per-service X" means a dedicated X, not a shared one with namespaced keys.** The
  service-prefixed keys (`note:` / `tags:` / `todo:`) keep namespaces disjoint, but they do
  **not** provide isolation — a shared instance is still a coupling point and a shared
  failure/eviction domain, which is exactly what "per-service" exists to prevent. When a new
  service is added, its instance is part of adding it.
- **Verify the premise *and its polarity*.** I correctly established "a cache exists", but
  the user was asserting "it has no *own* cache". Same facts, opposite conclusion: I checked
  presence, not ownership. For an isolation claim, check the boundary (which instance), not
  just the feature.
- **A capability map is a contract, not an inventory.** When it lags a shipped service,
  that gap is where a recorded decision gets silently broken. Updating `MAP-*.md` at
  add-time is what stops "one instance per service" from quietly becoming "whatever was
  already running".

See **0012** for the process-level cause: why the earlier decision was silently
overwritten and why per-chapter validation could not catch it.

## Applies to

`docs/specs/MAP-*.md` capability maps and `compose.yaml` whenever a service or its
dependencies change; Contract 2 cache reviews; and any "does this service have X?" check —
confirm ownership, not just presence.
