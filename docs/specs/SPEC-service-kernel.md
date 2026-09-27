# Spec: service-kernel (ecosystem service contracts + shared primitives)

Module id: `service-kernel` (see `MAP-todo-ecosystem.md`). Reference implementation
for health wiring: `apps/idp/src/health/health.controller.ts` (existing, to be
aligned) and note-service (retrofit).

## Objective

One service dialect for the whole ecosystem: every service (note, idp, tags, todo)
speaks the same health, error, pagination, and vocabulary contracts — so a later
orchestrator or Kubernetes rollout is pure addition, not rework. Also owns the two
shared primitives that would otherwise be forked (AGENTS.md Contract 2 no-fork rule).

## Contracts

### Health dialect (uniform across all services)

- `GET /health/live` → `200 {"status":"ok"}` — process liveness only. **Never**
  dependency checks (a DB blip must not restart containers).
- `GET /health/ready` → `200 {"status":"ok"}` | `503 {"status":"degraded"}` — checks
  what genuinely breaks serving: DB reachable (`SELECT 1`) + key custody loaded.
  **Deliberately not the Redis cache**: the Contract 2 cache is fail-open, so a cache outage
  must never take a service out of rotation. Readiness mirrors real failure semantics.
- `GET /health` — kept on **every** service as a deprecated alias of `/health/ready`
  (readiness semantics). Existing consumers depend on it (e.g. the Playwright harness
  `apps/app/test/e2e/stack.ts` polls `/health`), and it must keep answering.
- All three unauthenticated (probes cannot log in) but leak-free: no versions,
  config, or stack traces in bodies; cheap and side-effect-free.
- Wiring: compose `healthcheck` = `GET /health/ready` ("healthy" = can serve).
  Kubernetes later: `/health/live` → `livenessProbe`, `/health/ready` →
  `readinessProbe`. Optional `/health/startup` only if boot grows slow.
- Retrofit: note-service gains the trio; idp's existing `@Controller('health')` is
  aligned to the dialect (its current body becomes the `/health` alias behavior).

### `TagRef` — the shared tag vocabulary

- Shape: `{ tagId: number }`. Ids are owned by `tags-service` (sole writer; existing
  integer ids preserved — MAP decision M2).
- Consumers **never store tag names** (duplication forbidden). Resolution is
  `POST /api/tags/resolve {ids} → [{id, name}]` (owner-scoped), called by the app
  (BFF composition — no service-to-service calls in request paths, MAP M4).
- Semantics: rename is invisible to consumers (names resolve fresh); delete =
  **detach** — consumers treat unknown/foreign ids as detached: omit from DTOs and
  opportunistically prune association rows on writes. Domain content is never
  deleted as a side effect.
- A domain's tag usage surface is `GET …/tags → [{tagId, count}]` (ids + counts only).

### `origin` links — the orchestrator seam

- Shape: `{ service: 'note' | 'todo' | 'tags', id: string }` — the union is closed
  to the three current services and extended by adding the new service's own name
  (one place: this section). Nullable JSON on domain rows.
- Status in this chapter: **reserved, nothing populates it** (the future suggestion
  layer attaches it, e.g. a todo created from a note).

### API surface rules (mirror note-service conventions)

- Auth: Bearer JWT verified offline against the IdP JWKS; every query owner-scoped
  by `sub`.
- Errors: `401` unauthenticated; **`404` for foreign and missing ids alike,
  byte-identical** (binding precedent `SPEC-note-ownership.md` — never `403`, it
  leaks existence); `409` on stale `expectedVersion`. Body shape identical to
  note-service's.
- Pagination: cursor `base64(iso|id)`, per-domain stable order (defined in each
  domain spec).
- Concurrency: `version` int on mutable rows; PATCH accepts `expectedVersion`
  (omit = legacy last-write-wins, as notes).
- Ids: service-generated UUID v4 for new domain rows (notes precedent). Tag ids
  remain integers (M2).

### App → service transport contract

- Base URLs (app-side env): `API_URL` (note-service, existing), `TAGS_API_URL`,
  `TODO_API_URL`.
- **Token model — one shared ecosystem audience `life-api`** (decided after the
  conformance validator proved multi-audience tokens infeasible on the pinned
  `oidc-provider` 9.x: one audience per token, and `OIDC_AUDIENCE_MAP` is a
  resource→audience map that cannot emit an array): the app session keeps ONE
  access token (the `AppSession` shape is unchanged), minted with `aud: "life-api"`
  for whichever registered resource the app requests. All three services verify
  that single audience — each through its own `*_SERVICE_AUDIENCE` env knob (set to
  `life-api`), so a future split to isolated audiences is config, not code.
  Recorded trade-off: within this single-user security domain the token no longer
  distinguishes which service it addresses — accepted deliberately. Upgrade path:
  RFC 8707 per-resource tokens (three audiences, resource indicators — stock
  provider), contracts below unchanged.
- Per-service verification env (mirroring the note-service naming):
  `TAGS_IDP_JWKS_URL` / `TAGS_SERVICE_AUDIENCE`, `TODO_IDP_JWKS_URL` /
  `TODO_SERVICE_AUDIENCE` (existing: `NOTE_SERVICE_IDP_JWKS_URL` /
  `NOTE_SERVICE_AUDIENCE`) — all three audience values = `life-api`. Internal JWKS
  over the compose network by default (`http://idp:3003/jwks`), issuer =
  browser-facing URL (the established two-var pattern).
- Cache wiring: `REDIS_URL` per service (compose-injected, same pattern as
  note-service). All three services share the one `redis-note` instance —
  service-prefixed keys (`note:`/`tags:`/`todo:`) keep the namespaces disjoint.
- DB wiring: `DB_PATH` per service (tags/todo bind-mount `./apps/<svc>/data:/data`
  with `DB_PATH=/data/<name>.db`, note-service's pattern).
- Ownership: T8 implements the app-side client config; T9 wires env/compose/IdP
  (audience map → `life-api`, `apps/idp/test/**` fixture updates included).

## Shared primitives (no-fork, AGENTS.md Contract 2)

- `@life/cache` (`packages/cache`, new): the generic read-through cache extracted
  from `apps/note-service/src/notes/notes-cache.ts`. Generic signature:
  `createCache({ service, client, ttlSeconds = 60 })` → `cache.getThrough(sub, rest,
  loader, { decode, cacheable })`; keys compose as `<service>:<sub>:v<gen>:<rest>`
  (`service` comes from the constructor, `sub` per call). Per-owner generation
  counter, TTL backstop, fail-open, per-sub isolation. Values are always serialized
  rows as persisted (ciphertext for content). note-service refactors onto it;
  `tags-service`/`todo-service` consume it. The existing notes-cache contract suite
  is ported and becomes the shared suite.
- `likeMatch` (extracted into `@life/shared`): the LIKE-parity matcher from
  `apps/note-service/src/notes/content-match.ts` (`%`/`_` wildcards, ASCII-fold
  parity with SQLite `LIKE`, documented Unicode-fold deviation). Consumers run it
  over decrypted content after cache hits. The empirical parity suite is ported.

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/cache
           npm run test:unit -w @life/shared
           npm run test:unit -w @life/note-service -- test/health.e2e-spec.ts
Build:     npm run build -w @life/cache
```

(`test:unit` is added to `@life/shared`/`@life/ui`/`@life/idp` where missing — owned
by T1/T7/T2 respectively.)

## Testing Strategy

- Cache: the ported contract suite (values ciphertext-only, gen-counter, TTL,
  fail-open, key composition) runs against `@life/cache` generically.
- Matcher: the ported empirical parity suite (expectations generated by real SQLite
  `LIKE` bindings, not hand-coded).
- Health: per-service tests — `/health/live` stays 200 with the DB down;
  `/health/ready` flips 503 on DB down or missing key custody; `/health` alias
  answers identically to `/health/ready`; bodies leak nothing.

## Boundaries

- Always: specs updated before code; contract changes recorded here first.
- Ask first: any change to a contract shape (these are the orchestrator seam).
- Never: fork `notes-cache.ts`; put dependency checks in `/health/live`; store
  plaintext or DTOs in cache values; change frozen Playwright selectors (the I5 URL
  navigation change is the sole approved exception).

## Success Criteria

1. `@life/cache` + `likeMatch` exist in shared packages; note-service consumes both
   with zero behavior change (its suites stay green).
2. All four services answer the same health dialect (including the `/health` alias);
   compose healthchecks use `/health/ready`.
3. Every contract above is referenced (not re-invented) by the downstream specs.
