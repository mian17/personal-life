# 0011 — "Every backend service has a cache" must be *visible*, not just true

- **Date:** 2026-10-01
- **Source:** user question about the tags service and Redis

## Feedback

> "ok one question, why tag has no redis? it was supposed that always include cache
> for all backend services. please save this into lesson learned"

## What it corrected

The premise was wrong: tags-service **does** have a Redis read-through cache
(`apps/tags-service/src/tags/tags-cache.ts`, consumed at `tags.service.ts:102`
via `this.cache.getThrough(...)`), wired in `compose.yaml:64`
(`REDIS_URL: redis://redis-note:6379`, `depends_on: redis-note`), with a
`## Cache Rules` section in `SPEC-tags-service.md:61`. Nothing was omitted.

But the ask surfaced a real defect underneath the false premise: the **map of
the capability was never updated when the service was added**. `docs/specs/MAP-redis.md`
still lists exactly three modules (`app-state`, `idp-cache`, `note-cache`) even though
`tags-service` and `todo-service` later shipped caches too, and `compose.yaml`'s Redis
section comment still reads "app … and idp/note" while also wiring tags (line 64) and
todo (line 102). The code is consistent; the documentation of it is not — which is
exactly the condition that makes a reviewer ask "why has tag no redis?".

Two secondary signals that reinforce the misread, and are worth keeping in mind rather
than "fixing":
- Redis is selected by `REDIS_URL` at module init; **unset means the documented DB
  pass-through** (dev/e2e stay Redis-free). So running the suites locally shows the
  cacheless path by design.
- `/health/ready` deliberately **does not** probe the cache (it is fail-open), so a
  healthy service never evidences Redis. Presence must be read from compose + the
  `## Cache Rules` section, not from health or a local test run.

## The lesson

- **Verify the premise before acting on it.** "X was supposed to always happen, why
  doesn't X exist here?" split cleanly into two different answers: the code (X *does*
  exist — say so, with file:line) and the process (the artifact describing X is stale —
  fix *that*). Accepting the premise would have produced a wrong change.
- **When a new service is added to the ecosystem, its capability-map entry and its
  infra comments are part of the change.** A capability map (`MAP-*.md`) is the review
  surface for "did everyone get the contract?"; an entry that lags the code is not
  harmless — it manufactures false findings and erodes trust in the map itself.
- **A deliberate seam can look like an omission.** The `REDIS_URL`-unset pass-through is
  a recorded decision, not a missing feature. State the seam where a reader will meet it
  (compose comment + service spec), so "unset in dev" is never mistaken for "never built".

## Applies to

`docs/specs/MAP-*.md` capability maps and `compose.yaml` service/infra comments whenever a
service or its dependencies change; Contract 2 cache reviews; and any "why doesn't this
service have X?" investigation — check the code and the map separately.
