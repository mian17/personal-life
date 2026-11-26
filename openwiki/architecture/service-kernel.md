---
type: 'Reference'
title: 'Service kernel'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-b06cae4dcd962d226e614161
    resource: repo://packages/service-kit/src/auth/auth.guard.ts
  - id: openwiki-source-fb27e3de333c30f4e46b1c57
    resource: repo://packages/service-kit/src/grants/origin-grant.entity.ts
  - id: openwiki-source-8623baf8470a13244d7cc699
    resource: repo://packages/service-kit/src/health.controller.ts
  - id: openwiki-source-0787897cfe4750fefdb817fd
    resource: repo://packages/service-kit/src/health.service.ts
  - id: openwiki-source-9b816c81131c37af8b9eaf41
    resource: repo://packages/service-kit/src/outbox/outbox-poller.service.ts
  - id: openwiki-source-85235f2a74131932cd21d27e
    resource: repo://packages/service-kit/src/outbox/outbox.entity.ts
  - id: openwiki-source-e2eb94b060f24aab62e34387
    resource: repo://packages/service-kit/src/paging.ts
  - id: openwiki-source-5bf177f1ce836f6192004d88
    resource: repo://packages/service-kit/src/public.decorator.ts
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Service kernel

`@life/service-kit` is what every NestJS domain service shares: authentication,
the health dialect, cursor paging, batch execution, origin grants, audit
capture, key custody, and the transactional outbox. A new service imports the
module instead of re-implementing any of it — the same no-fork rule that
produced `@life/cache`.

## Health: one dialect, three routes

`HealthController` (`packages/service-kit/src/health.controller.ts`) gives every
service the same probes:

- `GET /health/live` → `200 {"status":"ok"}` — process liveness only, no
  dependency checked.
- `GET /health/ready` → `200 {"status":"ok"}` or `503 {"status":"degraded"}` —
  exactly two checks: the database answers `SELECT 1`, and the master key loads
  (key custody).
- `GET /health` — deprecated alias of `/health/ready`; the Playwright harness
  polls it and treats `<500` as ready.

All three are `@Public()` (probes cannot log in) and leak-free: the body is
exactly the status JSON, never versions, config or error details. Readiness
deliberately does **not** check Redis or RabbitMQ — both are fail-open on the
HTTP path, so their outage must never take a service out of rotation.

The check order and failure semantics live in `runReadinessChecks`
(`@life/shared`), so every service runs one readiness contract; each service
supplies only its datasource and master-key env name. Every service's
`test/health.e2e-spec.ts` asserts this dialect as a conformance suite.

## Authentication

`AuthGuard` verifies bearer tokens from the IdP (`auth/jwt-verifier.ts`) and
installs a principal (`sub`). Routes marked `@Public()` skip it entirely. Two
narrow exemptions, both narrower than they look: the `NODE_ENV=development`
bypass covers only a request that presents **no** credentials — a request with a
bearer token is always verified, so a bogus token answers `401` even in dev.

## Cursor paging

`paging.ts` is the one paging seam: opaque cursor codec, limit clamp (default
50, max 200), slice, `hasMore`/`nextCursor` assembly. What stays per service is
the _order_ — the stable sort key and its strictly-after test are passed in by
each caller, because no shared comparator can express e.g. the todo order
(`~`-undated first, then date buckets) without being cleverer than the code it
replaces. The module decrypts nothing and sorts nothing: services hand it rows
already decoded, filtered and ordered (plaintext lives in the request path).

## Batch execution

`batch/` runs a list of items with one bounded transaction and one cache
generation bump per batch (see [Data layer](data-layer.md)), returning
per-item results (`batch-item.ts`) under a shared limit (`batch-limits.ts`).

## Origin grants and audit

`grants/` owns the origin-grant record: when an outside surface (a meal-origin,
a focus-origin) is granted the right to create or tick todos, the grant is
written before the intent is enqueued — the toggle flag is a convenience, never
the enforcement point. `audit/` captures an audit trail (entity, listener,
middleware) shared by every service.

## Key custody

`keys/` provides the `MASTER_KEY` DI token, the `KeysService` per-owner DEK
custody, and the `user_keys` entity — covered in [Crypto at rest](crypto-at-rest.md).

## The outbox building blocks

`outbox/` is the transactional-outbox kit (mechanics only; the todo integration
flow is [Todos and the transactional outbox](../workflows/todos-and-outbox.md)):

- `Outbox` entity — one "tell another service" intent, inserted **in the same
  transaction** as the business row it belongs to. A committed write can never
  lose its notification; a rolled-back one can never send it.
- `OutboxPollerService` — the only reader and the only writer of `publishedAt`,
  so a crash between "sent" and "marked sent" re-sends rather than loses
  (at-least-once). Rows are delivered **sequentially**: parallel fan-out would
  let one failing row abort or reorder the batch, and the cursor advances only
  after the broker confirms. Each sweep is bounded so a backlog can never
  monopolize one tick.
- `OutboxDelivery` — the transport port; with delivery unconfigured the poller
  warns exactly once and sends nothing.

## See also

- [Data layer](data-layer.md) — the cache contract the batch bump implements.
- [Identity and access](../workflows/identity-and-access.md) — who issues the
  tokens `AuthGuard` verifies.
- [Testing strategy](../testing/strategy.md) — the conformance suites that pin
  this dialect.
