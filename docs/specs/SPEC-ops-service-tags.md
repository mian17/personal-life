# SPEC-ops-service-tags — module id `ops-service-tags`, body extracted verbatim from the frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.4

### 1.4 Module `ops-service-tags` — `apps/tags-service` (4 routes, 2 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `tags` (`/api/tags`) | `create` | `name`* string | `POST /api/tags` (create-or-get; the dual 201/200 never reaches rendering — executor returns the body) |
| | `list` | — | `GET /api/tags` |
| | `update` | `id`* number; `name`* string; `expectedVersion` number | `PATCH /api/tags/:id` (numeric id stringified by `wire.ts:57`) |
| `tags-resolve` (`/api/tags/resolve`) | `create` | `ids`* number[] | `POST /api/tags/resolve` |

`tags-resolve` is a pure read mislabelled `create` by the closed kind set (the
kind names the wire shape, not the semantics), so it carries the one
`isDestructive: false` override in this run (Assumption 8). `DELETE /api/tags/:id`
is absent (policy, §1.7).
