# SPEC-ops-service-todo — module id `ops-service-todo`, body extracted verbatim from the frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.2

### 1.2 Module `ops-service-todo` — `apps/todo-service` (12 routes, 5 resources)

| resource (basePath) | kind | fields | wire request |
|---|---|---|---|
| `todos` (`/api/todos`) | `create` | `title`* string; `note` string; `dueDate` string (ISO datetime, `ISO_DUE`); `repeat` string enum `TODO_REPEATS`; `repeatDays` number[]; `listId` string; `important` boolean; `tagIds` number[] | `POST /api/todos` |
| | `list` | `q` string; `listId` string; `tagId` number; `done` boolean; `important` boolean; `dueBefore` string; `dueAfter` string; `limit` number; `cursor` string | `GET /api/todos` (supplied fields as query params, `cursor` opaque) |
| | `get` | `id`* string | `GET /api/todos/:id` |
| | `update` | `id`* string; `title` string; `note` string; `done` boolean; `dueDate` string; `repeat` string enum; `repeatDays` number[]; `listId` string; `important` boolean; `tagIds` number[]; `expectedVersion` number | `PATCH /api/todos/:id` |
| | `delete` | `id`* string | `DELETE /api/todos/:id` (soft delete) |
| | `restore` | `id`* string | `POST /api/todos/:id/restore` |
| `todos-tags` (`/api/todos/tags`) | `list` | — | `GET /api/todos/tags` |
| `todos-trash` (`/api/todos/trash`) | `list` | `limit` number; `cursor` string | `GET /api/todos/trash` |
| `todos-completions` (`/api/todos/completions`) | `list` | `limit` number; `cursor` string | `GET /api/todos/completions` |
| `lists` (`/api/lists`) | `create` | `name`* string; `importantDefault` boolean | `POST /api/lists` |
| | `list` | — | `GET /api/lists` |
| | `update` | `id`* string; `name`* string; `importantDefault` boolean; `expectedVersion` number | `PATCH /api/lists/:id` |

Fields mirror `apps/todo-service/src/todos/dto/*` and `lists/dto/*` one-for-one.
`tagIds`/`ids` arrays are `number[]` (`@IsInt({each: true})`, no conversion).
Null-clear is gone (§1.7): `note`, `dueDate`, `listId`, `repeat`, `repeatDays`,
`important` on todo `update`, and `importantDefault` on list `update`, carry plain
values only. `DELETE /api/lists/:id` is absent (policy, §1.7). No `push` resource
is declared — all three push routes are cut browser plumbing (§1.7), so the
intent's `push` grouping has no surviving route.
