# SPEC-ops-service-focus — module id `ops-service-focus`, body extracted verbatim from frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.5

### 1.5 Module `ops-service-focus` — `apps/focus-service` (3 routes, 2 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `goal` (`/api/goal`) | `list` | — | `GET /api/goal` |
| `sessions` (`/api/sessions`) | `create` | `date`* string (`YYYY-MM-DD`); `minutes`* number | `POST /api/sessions` |
| | `list` | `from`* string; `to`* string | `GET /api/sessions` |

`PUT /api/goal` is absent (no `PUT`, §1.7); the goal is read-only through ops.
