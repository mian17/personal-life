# Spec: `idp-cache` — read-through cache over the IdP users table

Traces to: `docs/specs/MAP-redis.md`, `docs/intent/redis-shared-state.md`.

## Objective

`apps/idp` gets its own read-through cache in front of its DB so login-path lookups can
be served from cache when the IdP is scaled to N replicas. The DB stays the source of
truth; cache loss degrades to DB reads and is never *wrong*. **Rotating OIDC state
(sessions, grants, interactions, refresh tokens) is explicitly not cached** — it rotates
or revokes on every use, so a stale value is a security bug and the hit rate is ~0.

## Contract (the seam)

- Cache wraps exactly one hot read: `UsersService.findByUsername` (called by
  `login/credentials.ts` on every login attempt). Key `idp:user:<username>` → serialized
  user row (the argon2 hash is part of it — `verifyPassword` needs it). TTL 300s.
- Invalidation: `createUser` (and any future user mutation) deletes the key. Reads are
  read-through: miss → DB → populate. Negative lookups (unknown username) may cache a
  short-TTL sentinel (30s) to blunt brute-force DB reads — but the login response shape
  must stay identical for unknown user vs wrong password (no enumeration; existing e2e).
- Fail-open: any Redis error → fall through to the DB (correct, degraded). No
  behavioral difference in any response — only latency.
- Selection once at module init: `REDIS_URL` set → cached wrapper; unset → today's
  direct DB path. Dev/e2e unchanged.

## Security posture (hard line)

The cached value includes a password hash. Exposure boundary must equal `idp.db`'s:
the Redis service is **internal-network only, no published host port**, values are never
logged or serialized outside `UsersService`, keys contain only the username. If any of
these cannot hold, the cache is removed rather than weakened.

## Tech Stack

`redis` (node-redis — cluster-ready), NestJS provider wrapping the existing `UsersService` read.

## Commands

```
Unit/e2e:   npm run test -w apps/idp
Typecheck:  npm run lint
Integration: none built (optional future TEST_REDIS_URL-gated describe) — coverage is the fake-client suite + module-boundary tests (OIDC payloads never cached); the TEST_REDIS_URL seam lives in apps/app's hop proof.
```

## Project Structure

```
apps/idp/src/users/users.service.ts        → read-through + invalidation (the seam)
apps/idp/src/users/users-cache.ts          → cache helper (get-through / invalidate)
apps/idp/test/users-cache.e2e-spec.ts      → hit / miss / invalidate / fail-open
apps/idp/test/login.e2e-spec.ts            → unchanged behavior (enumeration, cookies)
```

## Code Style

```ts
async findByUsername(username: string): Promise<User | null> {
  const name = username?.trim();
  if (!name) return null;
  return this.cache.getThrough(`idp:user:${name}`, () => this.users.findOne({ where: { username: name } }));
}
```

Thin wrapper at the service boundary — controllers and `credentials.ts` do not know a
cache exists. House comment style: state the *why* (rotation exclusion, hash rationale).

## Testing Strategy

- Hit/miss: second `findByUsername` does not touch the repository (spy on the repo).
- Invalidation: `createUser` → next read comes from DB.
- Fail-open: injected failing client → login path still verifies correctly.
- Regression: full idp suite (81) green with `REDIS_URL` unset; the no-enumeration e2e
  is the gate on response-shape stability.

## Boundaries

- **Always:** fail open to DB; keep response shapes identical; 300s TTL ceiling.
- **Ask first:** caching anything beyond the users table; any user-mutation path.
- **Never:** cache `OidcPayload` rows / session / grant / interaction state; publish the
  Redis port; log cached values; touch `apps/note-service/`.

## Success Criteria

1. Second identical login lookup is a cache hit (unit-proven).
2. `createUser` invalidates (unit-proven).
3. Redis down → login flow behaves exactly as today (fail-open e2e).
4. idp suite green with `REDIS_URL` unset.

## Open Questions

None.
