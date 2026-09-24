# Spec: `note-service-rs` — `apps/note-service` becomes a resource server

Traces to module id: `note-service-rs` (see `docs/specs/MAP-idp.md`).
Traces to intent: `docs/intent/idp.md`.

## Objective

`note-service` stops trusting a shared static secret and instead verifies every request
against JWTs issued by `idp`: signature verified offline against `idp`'s JWKS, with an
audience scoped to `note-service` (so a token minted for `todo-service` is refused here).
Then `API_TOKEN` is retired and every service authenticates its own callers.

## Tech Stack

NestJS guard replacing the current token guard (same `apps/note-service`), a maintained
JWKS/JWT verification library (choose at implementation; constraint: standard-compliant),
key set cached with rotation-tolerant refresh (fetch on unknown `kid`, bounded cache).

## Commands

```unknown
npm run dev   -w apps/note-service
npm run build -w apps/note-service
npm test      -w apps/note-service   # existing 16 e2e + new auth e2e
npm run lint  -w apps/note-service
```

## Project Structure

```unknown
apps/note-service/src/auth/
  auth.guard.ts        JWT verification (replaces static token comparison)
  jwks.ts              key set fetch/cache with rotation handling
```

## Code Style

Same NestJS conventions as the rest of the service; the guard is the only enforcement
point and stays thin — verification logic lives in `auth/`, not in controllers.

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const token = readBearer(ctx);
    const claims = await this.verifier.verify(token); // signature, exp, aud='note-service'
    if (claims.aud !== 'note-service') throw new UnauthorizedException();
    return true;
  }
}
```

## Testing Strategy

Jest + supertest e2e alongside the existing suite: valid token → 200; wrong audience →
401; expired → 401; tampered signature → 401; garbage/missing header → 401; JWKS rotation
(a new `kid`) still verifies. During the dual-run window, the `API_TOKEN` path keeps its
existing tests until it is removed — removal is its own commit, with the old tests deleted
in the same commit.

## Boundaries

- Always: reject on any verification doubt (fail closed); validate `aud`, `exp`, `iss`;
  tests before commits; the existing 16 e2e stay green throughout.
- Ask first: accepted `iss`/`aud` values, clock-skew tolerance, cache TTLs, adding a
  second audience, removing the `API_TOKEN` path.
- Never: call `idp` per request to "check" a token; accept `alg: none`; log raw tokens;
  share a verification secret with any other service.

## Success Criteria

- [ ] Every request without a valid, correctly-audience-scoped JWT is 401 — proven by e2e.
- [ ] A token for a different service (`aud=todo-service`) is rejected here.
- [ ] Key rotation at `idp` does not break verification (e2e with a rotated `kid`).
- [ ] `API_TOKEN` fully retired: removed from code, `.env*` examples, compose, and README
      in one commit (follow `deprecation-and-migration` for that commit).

## Open Questions

1. Dual-run window length — accept both `API_TOKEN` and JWT for a while, or hard-switch
   in one commit? (Recommendation: short dual-accept window, then one removal commit.)
2. Clock-skew tolerance (proposal: 30s).
3. Should `todo-service` later reuse this guard via `packages/shared`, or copy the module?
   (Recommendation: decide at `todo-service` time — copying twice is cheaper than a wrong
   abstraction.)
