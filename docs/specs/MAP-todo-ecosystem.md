# Capability Map: todo-ecosystem

Intent: `docs/intent/todo-ecosystem.md`. Spec-first per AGENTS.md; each module gets
its own spec (`SPEC-<module-id>.md`) in this directory. Plan/tasks live in
`tasks/plan-todo-ecosystem.md` / `tasks/todo-todo-ecosystem.md`.

| Module id | Responsibility | Depends on |
|---|---|---|
| `service-kernel` | Ecosystem service contracts: health dialect (`/health/live`, `/health/ready`), `TagRef` vocabulary, `origin`-link convention, shared API surface rules (auth, errors, pagination, optimistic concurrency). Shared primitives: the generic read-through cache extracted from `notes-cache.ts` into `@life/cache` (AGENTS.md Contract 2 no-fork rule), the LIKE-parity matcher extracted into `@life/shared`. Health retrofit into note-service + idp. | — |
| `tags-service` | Standalone ecosystem tag registry (`apps/tags-service`): tag CRUD, case-insensitive create-or-get, ecosystem-wide rename, delete-detach, batch name resolution. Own key custody, `@life/crypto` at rest, Contract 2 cache, kernel contracts. | `service-kernel` |
| `tags-extraction` | note-service becomes a registry consumer: association-only `note_tag` (TagRefs by id), registry-composed tag filters/listing, lazy pruning of dangling refs. Human-run migration script moving tag rows note-DB → tags-DB (re-encrypted under the registry's keys), id-preserving and idempotent. | `tags-service` |
| `todo-service` | Standalone todo service (`apps/todo-service`): todos (title, optional note, done, dueDate), todo-local lists, TagRefs, `origin` links. Own key custody, `@life/crypto` at rest, Contract 2 cache, kernel contracts. | `service-kernel`, `tags-service` |
| `todo-ui` | Route move `/` → `/notes` (+ redirect), new `/todos` UI, shared tag picker/manager UX wired to the registry from both apps. All visuals composed from `@life/ui` (spec-first upstream for anything new). | `todo-service`, `tags-extraction` |

Build order: `service-kernel` → `tags-service` → (`tags-extraction` ∥ `todo-service`) → `todo-ui`.

## Cross-cutting design decisions (recorded per global protocol §8)

| # | Decision | Rationale |
|---|---|---|
| M1 | **Approach 2 — global taxonomy + local references** (user-confirmed 2026-09-28): `tags-service` owns the taxonomy only (ids + names, later `color`/`slug` if ever wanted); each domain owns its own association rows referencing registry ids (`TagRef`). No polymorphic/foreign-entity references ever live in the registry. | Keeps AGENTS.md Contract 2 row-set caching + in-memory filtering local per service (no cross-service join in read paths); classic shared-kernel split — vocabulary is shared, associations are domain data; the orchestrator seam is the `TagRef` + registry API, unaffected. The alternative (centralized associations) puts a network hop into every tag-filtered listing. |
| M2 | Tag ids stay the existing integer ids; the registry is the sole writer of tag ids. | The migration moves rows without rewriting `note_tag` values — smallest cut-over surface. UUID ids remain an upgrade path if services ever merge. |
| M3 | Per-service key custody: `TAGS_MASTER_KEY` / `TODO_MASTER_KEY` env keys, each service with its own `user_keys`. The migration re-encrypts (decrypt with note-service DEK, encrypt under registry DEK; plaintext never at rest). | Same envelope contract as `SPEC-notes-at-rest`; per-service master keys keep blast radius small. |
| M4 | No service-to-service calls in request paths: the app composes (BFF). Name resolution is a batch API the *app* calls. | The orchestrator, if it comes, replaces composition — contracts don't change. |
| M5 | New services (`tags-service`, `todo-service`) start fully encrypted — no dual-read. Dual-read remains a note-service legacy-row concern only. | No legacy rows exist in new stores. |
