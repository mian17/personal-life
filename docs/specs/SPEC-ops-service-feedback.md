# SPEC-ops-service-feedback — module id `ops-service-feedback`, body extracted verbatim from frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.6

### 1.6 Module `ops-service-feedback` — `apps/feedback-service` (2 routes, 1 resource)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `feedback` (`/api/feedback`) | `list` | — | `GET /api/feedback` |
| | `update` | `id`* string (UUIDv4, server-parsed); `status`* string enum `FEEDBACK_STATUS_VALUES` (`open`\|`in_progress`\|`done`\|`wont_do`) | `PATCH /api/feedback/:id` |

`POST /api/feedback` is absent (§1.7, Open Question 10.1).
