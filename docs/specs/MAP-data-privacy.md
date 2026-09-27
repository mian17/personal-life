# Capability Map: data-privacy (note-content encryption at rest)

Status: APPROVED (user gate 2026-09-27; continued autonomously per AGENTS.md §8)

| Module id | Responsibility | Depends on |
|---|---|---|
| `crypto` | Shared envelope-encryption package `@life/crypto`: DEK generation, AES-256-GCM field crypt, KEK wrap/unwrap/rewrap, envelope formats v1. Consumer-agnostic | — |
| `notes-at-rest` | note-service integration: encrypted persistence of `note.body` + `tag.name`, `user_keys` table, ciphertext-only cache, decrypt-then-match search/tag filtering | `crypto` |
| `notes-backfill` | Idempotent plaintext→envelope migration script, tag unique-index relocation, master-key rotation (rewrap) script, deploy-window checklist | `notes-at-rest` |

Build order: `crypto` → `notes-at-rest` → `notes-backfill`.

Specs: `SPEC-crypto.md`, `SPEC-notes-at-rest.md`, `SPEC-notes-backfill.md` (this dir).
Intent: `docs/intent/data-privacy.md`.

Out of scope: todo-data encryption (its own chapter; `@life/crypto` is its entry
point), IdP identity fields, E2EE/password-derived keys, blind/plaintext search
indexes, any UI change.
