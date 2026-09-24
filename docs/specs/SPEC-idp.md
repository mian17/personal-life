# Spec: `idp` — the identity provider service

Traces to module id: `idp` (see `docs/specs/MAP-idp.md`).
Traces to intent: `docs/intent/idp.md`.

## Objective

A small, self-owned OpenID Connect IdP as its own service. It owns **all** identity data
(users, password hashes, sessions, signing keys, client registry) and answers exactly one
question for the rest of the stack: "who is this, and what may they access?"

Capabilities (sections below): users + credentials, login UI + sessions, OIDC core.
Deliberately core OIDC only — no roles, passkeys, social login, federation, multi-tenancy,
or email/reset infrastructure.

## Tech Stack

- NestJS 11 + TypeORM + better-sqlite3, Node 22 — same shape as `note-service`.
- Protocol surface: `oidc-provider` (MIT, v9.x, OpenID-certified) mounted in `apps/idp`,
  configured to enable **only** discovery, authorization code + PKCE, token, refresh
  rotation, and JWKS. We own users, argon2id credentials, login UI, sessions, the client
  registry, policies, and the SQLite storage adapter; the library owns spec compliance.
- Own database: `apps/idp/data/idp.db` (per-service data boundary; credentials never
  touch the notes database).
- Passwords: argon2id. JWT: EdDSA/Ed25519 asymmetric signing (RS256 only if a consumer
  demands it) with a JWKS endpoint — services verify offline, never call the IdP per
  request. Lifetimes: access 10 min, refresh 30 days with rotation + reuse detection.
- Compose: new `idp` service on the internal network (hostname `idp`, dev port 3003).

## Commands

```unknown
npm run dev   -w apps/idp     # watch mode
npm run build -w apps/idp     # nest build
npm test      -w apps/idp     # jest e2e (testRegex .e2e-spec.ts)
npm run lint  -w apps/idp     # tsc --noEmit
```

## Project Structure

```unknown
apps/idp/
  src/
    users/        accounts + credential hashes (the only place they exist)
    login/        login UI routes + session lifecycle
    oidc/         oidc-provider config + SQLite adapter, client registry
    crypto/       signing key management (generation, rotation hooks)
  test/           *.e2e-spec.ts
  data/           idp.db (gitignored, backed up like life.db)
```

## Code Style

Same conventions as `note-service`: constructor injection, class-validator DTOs, thin
controllers / fat services, typed shared DTOs in `@life/shared` where crossed.

```typescript
@Injectable()
export class TokenService {
  constructor(private readonly keys: SigningKeyService) {}

  /** Short-lived, audience-scoped access token. Never logged. */
  issueAccessToken(subject: string, audience: string): Promise<string> {
    return this.keys.sign({ sub: subject, aud: audience, exp: this.now() + ACCESS_TTL_S });
  }
}
```

## Testing Strategy

Jest + supertest e2e (matches `note-service`). Must-cover flows: password login
success/failure (failure returns identical shape either way — no user enumeration),
authorization code + PKCE happy path, PKCE verifier mismatch rejected, refresh rotation,
token minted by `idp` verifies offline against JWKS, wrong-audience and expired tokens
rejected. No coverage percentage gate; every auth-relevant branch has a test.

## Boundaries

- Always: standard primitives only; constant-time comparisons for secrets; validate all
  inputs (class-validator); tests green before every commit; tokens/passwords never logged.
- Ask first: DB schema changes, new dependencies, token lifetime changes, registering new
  clients, any endpoint that returns a token.
- Never: invent cryptography; store or transmit plaintext passwords; commit `apps/idp/data/`
  or signing keys; put identity data in any other service's database.

## Success Criteria

- [ ] A token minted by `idp` verifies in a standalone check against JWKS alone, with `aud`
      enforced (right audience passes, wrong audience 401s).
- [ ] All e2e flows above green via `npm test -w apps/idp`.
- [ ] `life.db` and `apps/idp/data/idp.db` are the only identity-adjacent stores, and
      credentials exist only in the latter.
- [ ] The running app's current auth flow is untouched (`idp` ships dark until `app-rp`).

## Decisions (2026-09-24, plan review)

1. **Protocol surface: library-backed `oidc-provider`.** We own the service, users,
   sessions, clients, policies, and storage adapter; the library owns spec compliance.
2. **Seeded single user** (me) + a seed script; no signup path. More users later = data.
3. **Token lifetimes:** access 10 min, refresh 30 days with rotation + reuse detection.
4. **Signing:** EdDSA/Ed25519 (RS256 only if a consumer demands it).
5. **Hostname/port:** `idp:3003` internal (dev).

All open questions resolved. Implementation starts on the human's go (Task 1 of
`tasks/todo-idp.md`).
