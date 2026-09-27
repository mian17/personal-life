# Intent: data-privacy (note-content encryption at rest)

Status: CONFIRMED (interview-me restate — explicit "yes" 2026-09-27)

## Confirmed restate

- Outcome: All note content — `note.body`, `tag.name` (the only content fields in the
  schema; there is no title column) — stored as ciphertext in the DB via envelope
  encryption: per-user random DEK, AES-256-GCM per field, wrapped by a server-held
  master key. A leaked dump, escaped backup, or nosy DBA sees nothing readable.
- User: The owner of this single-user personal stack; the crypto layer is written
  generic so todo-service consumes it in its own chapter later.
- Why now: Data privacy before the todo chapter widens the data surface.
- Success: DB **and the Redis cache** hold ciphertext only; search/tags/trash UX and
  semantics unchanged (decrypt-then-match, LIKE-parity unit test); password change and
  key rotation never touch note data; existing notes migrated to ciphertext.
- Constraint: DB-only adversary (server trusted — an admin on the app host can still
  read; accepted trade). Ciphertext everywhere outside the request path: DB, Redis
  cache (stores encrypted rows), logs, backups. Master key in env/secret config,
  never in the DB or logs.
- Out of scope: True E2EE / password-derived keys (OIDC conflict + forgot-password =
  data loss); blind/plaintext search indexes; IdP identity fields; todo encryption
  itself (interface only).

## Decisions recorded during the interview

1. Adversary = DB-only (dumps, backups, DBA curiosity). Server trusted.
2. Key hierarchy = envelope encryption: per-user random DEK, wrapped by a
   server-held master key (env). NOT password-derived — offline brute-force surface,
   OIDC conflict (services never see passwords), recovery cliff.
3. Password change/reset = non-event for keys. Rotation = rewrap DEKs, never
   re-encrypt content.
4. Search = decrypt-then-match in the service layer (`LIKE` cannot run over
   ciphertext; the DB never sees plaintext). Parity with today's semantics is the
   acceptance criterion. Blind indexes ruled out (leak + wrong semantics).
5. Cache (Redis-backed, AOF-persistent) stores **ciphertext rows only** — plaintext
   exists transiently in the request path only.
6. Shape = shared library (`@life/crypto`), not a network service.
