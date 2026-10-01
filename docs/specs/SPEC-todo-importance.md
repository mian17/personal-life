# Spec: todo-importance (todo/list importance signal)

Module id: `todo-importance` (see `MAP-settings-and-matrix.md`). Backend capability of
`apps/todo-service`; it extends the existing todo domain (title, optional note, done,
dueDate) with one manual importance signal — no new process, no new route family.

Traces to intent: `docs/intent/eisenhower-matrix-and-settings.md` (locked decision L6).
Map: `docs/specs/MAP-settings-and-matrix.md` (cross-cutting decision D4).
Contracts: `AGENTS.md` Contract 2 (BE → cache → DB), `SPEC-service-kernel.md`,
`SPEC-todo-service.md`.

## Objective

Carry a manual importance flag on the todo domain so the Eisenhower matrix (the
`matrix-ui` module) can place each todo in a quadrant: importance is **manual**, defaulted
by the todo's list and overridable per todo; urgency stays derived from `dueDate`. The
matrix introduces no new input. This module owns only the stored/delivered importance
signal and its cache contract — quadrant rendering, urgency derivation, and the settings
opt-in live in `matrix-ui`.

## Data model

Two nullable plaintext boolean columns are added to `SPEC-todo-service`'s existing tables:

```
todo(
  ...
  important BOOLEAN NULL,            -- NULL = inherit the list default
  ...
)
list(
  ...
  importantDefault BOOLEAN NULL,     -- NULL = false
  ...
)
```

- `todo.important` is **plaintext metadata**, not content. Like `done` and `dueDate`, it
  is a sortable/filterable operational flag that contains no user text, so it does NOT go
  through `@life/crypto`: there is no `enc.v1.` envelope, no AAD, no key involvement.
  This is the deliberate exception that already exists for `done`; it is recorded here in
  the same spirit as the `dueDate` decision in `SPEC-todo-service.md`.
- Contrast with the content columns: `todo.title`, `todo.note`, and `list.name` remain
  `enc.v1.` envelopes with their existing AADs
  (`life.v1|<sub>|todo|title|<id>`, `life.v1|<sub>|todo|note|<id>`,
  `life.v1|<sub>|list|name|<id>`). A boolean cannot carry content and is never encrypted.
- `NULL` semantics are the whole feature:
  - `todo.important IS NULL` → **inherit**: the effective value comes from the todo's list.
  - `list.importantDefault IS NULL` → **false**.
- No denormalization. The effective value is **computed at read time**, never stored on the
  todo row, so changing a list's `importantDefault` applies to every inheriting todo with
  no per-todo write fan-out.

## Effective importance (computed, never stored)

```
effectiveImportant(todo, list) = todo.important ?? list.importantDefault ?? false
```

- Computed in the service during DTO assembly, **after decryption** of the content fields
  (the same post-hit assembly that already runs in `TodosService.decodeCachedTodoRow`).
- The list default is resolved from the owner's cached list row-set (`todo:lists`) by the
  todo's `listId`, in memory. Todos and lists share one `todo` generation counter, so
  within a generation the two cached row-sets are consistent; a list write bumps that
  counter and both shapes refresh together (`SPEC-todo-service.md` Cache Rules).
- Edge cases:
  - Todo has no list (`listId IS NULL`) → no default exists → `important ?? false`.
  - List deleted: `todo.listId` becomes `NULL` (`ON DELETE SET NULL`, detach semantics), so
    an inheriting todo's effective value falls back to `false`; an explicit
    `todo.important` is untouched and still wins.
  - Trashed todos are excluded from `GET /api/todos` (existing rule); importance changes
    none of the trash semantics (trash/restore never bump `version`).

## Behavior / API

The wire types are exported from `@life/shared` (the `Todo`/`List` precedent); the app
consumes, never re-declares. All new fields are additive and optional on the wire.

### Todo

Request DTOs (`CreateTodoDto` / `UpdateTodoDto`, mirrored on `CreateTodoInput` /
`UpdateTodoInput` in `@life/shared`):

| Field | Type | Create | Update |
|---|---|---|---|
| `important` | `boolean \| null` | optional; omitted or `null` ⇒ stored `null` (inherit) | optional; omitted ⇒ unchanged (last-write-wins); `null` ⇒ clears to `null` (inherit); `true`/`false` ⇒ explicit override |

- `CreateTodoInput.important?: boolean | null`
- `UpdateTodoInput.important?: boolean | null` — `null` clears the override back to
  "inherit the list default"; omitting leaves the stored value unchanged. Validation:
  `@IsOptional() @ValidateIf((_o, value) => value !== null) @IsBoolean()` (the
  `note`/`dueDate`/`listId` nullable-field pattern).

Read DTO (`Todo` in `@life/shared`, returned by `POST`, `GET /api/todos`,
`GET /api/todos/:id`, `PATCH`, `POST /:id/restore`):

| Field | Type | Meaning |
|---|---|---|
| `important` | `boolean \| null` | the stored override exactly as persisted; `null` = inherit |
| `effectiveImportant` | `boolean` | the computed value `important ?? list.importantDefault ?? false` |

- Both fields are present on every todo read. `effectiveImportant` is the field the matrix
  consumes; clients that need to distinguish "explicitly not important" from "inherited
  not important" read `important` (`false` vs `null`).
- `GET /api/todos` filters gain an optional `important?: boolean` query filter
  (matched against `effectiveImportant`), applied **in memory** off the cached `todo:all`
  row-set after decryption — filter params never enter the cache key
  (`ListTodosQuery` pattern). `effectiveImportant` is never a SQL predicate.

### List

Request DTOs (`CreateListDto` / `UpdateListDto`; `List` is the exported `@life/shared`
read shape and the request bodies mirror the service DTOs):

| Field | Type | Create | Update |
|---|---|---|---|
| `importantDefault` | `boolean \| null` | optional; omitted or `null` ⇒ stored `null` (= false) | optional; omitted ⇒ unchanged; `null` ⇒ `null` (= false); `true`/`false` ⇒ sets the default |

- `POST /api/lists {name, importantDefault?}` · `PATCH /api/lists/:id
  {name, importantDefault?, expectedVersion?}` — `importantDefault` is additive; `name`
  keeps its required/required shape (PATCH still requires `name`). A collision check is
  unchanged (name only); `importantDefault` does not participate in list identity.
- Read DTO (`List` in `@life/shared`, returned by `POST`, `GET /api/lists`,
  `PATCH`): `importantDefault: boolean | null` — nullable as stored; `null` means false,
  so a client computes the default as `importantDefault ?? false`.

## Cache Rules (AGENTS.md Contract 2 Rule 4)

The importance signal rides the **existing** `redis-todo` read-through cache. No new cache
instance, no new cache shape, no new key component.

- **Cached shapes (updated):** the serialized todo rows under `todo:all` (and `todo:trash`)
  now carry `important: boolean | null` — a plaintext, non-content field copied verbatim
  from the row alongside the already-plaintext `done`/`dueDate`/`listId`. The serialized
  list rows under `todo:lists` now carry `importantDefault: boolean | null`. The
  `CachedTodoRow` / `CachedListRow` shapes gain exactly these two fields; nothing else
  changes.
- **Content stays ciphertext:** `title`, `note`, and `list.name` are still `enc.v1.`
  envelopes in the cached values. The new booleans are **non-content and are the
  documented plaintext exception**, mirroring `done` — they contain no user text, so they
  are stored in the clear in SQL and in Redis. Plaintext content must never appear in a
  cached value.
- **The ciphertext assertion still holds:** the existing `isCiphertextTodoRow` /
  `isCiphertextListRow` guards (and the cache suite's no-known-plaintext assertions) are
  unchanged and must still fail closed if any content plaintext leaks. Adding an
  unencrypted boolean does not relax them; the suite's ciphertext assertions continue to
  assert `enc.v1.` for the content fields and the absence of known plaintext
  (`test/todo-cache.e2e-spec.ts`).
- **Key shape unchanged:** `todo:<sub>:v<gen>:<rest>` (including
  `todo:<sub>:v<gen>:trash`). `important`/`importantDefault` are row data, not request
  parameters; the `important` list filter is applied in memory off the hit, exactly like
  `q`/`tagId`/`listId`/`done`/`due*`, so it never enters the key.
- **Invalidation unchanged:** the per-owner generation counter `todo:gen:<sub>` is bumped
  **after** every successful write, including a list write that changes
  `importantDefault` — which is precisely what makes an inheriting todo pick up the new
  default on its next read without any per-todo write. A failed mutation never bumps.
- **TTL backstop unchanged:** 60s (`CACHE_TTL_SECONDS`).
- **Fail-open unchanged:** any cache error degrades to the direct loader; the fallback
  path never writes plaintext content.
- **Decrypt / filter / assemble after every hit:** content decryption and the
  `effectiveImportant` assembly run post-hit; the effective-importance resolution joins the
  cached list row-set to the cached todo row-set in memory.

## Filtering and matrix placement are in-memory (post-decrypt)

Importance/urgency filtering and quadrant placement run **in memory after decryption** in
the app/service (the `content-match.ts` / `likeMatch` pattern), never as SQL over
encrypted columns. `important` is plaintext, but the ordering and grouping of a matrix view
still depend on decrypted `title`/`note`, so the whole placement step happens post-decrypt
off the cached row-sets. No `ORDER BY`/`WHERE` over encrypted columns is introduced.

## Commands

```
Typecheck: npm run typecheck -w @life/todo-service
Test:      npm run test:unit -w @life/todo-service -- test/todos.e2e-spec.ts
           npm run test:unit -w @life/todo-service -- test/todo-cache.e2e-spec.ts
Build:     npm run build -w @life/todo-service
```

## Testing Strategy

1. Round-trip: create a todo with `important: true` → read DTO exposes `important: true` and
   `effectiveImportant: true`; create with `important` omitted/null → `important: null`.
2. Inheritance: a list with `importantDefault: true` makes an inheriting todo
   (`important: null`) report `effectiveImportant: true`; an explicit `important: false`
   on that todo reports `effectiveImportant: false` (override wins).
3. No write fan-out: change `list.importantDefault` → existing inheriting todos report the
   new effective value on the next read with no todo write and no version bump.
4. Null semantics: `list.importantDefault: null` ⇒ effective false; a todo with no list
   (`listId: null`) ⇒ `important ?? false`; clearing `important` via PATCH `null` returns
   the todo to inheritance.
5. Detach: delete a list → its todos survive with `listId: null`; an inheriting todo's
   effective value becomes false while an explicit override survives.
6. Filter: `GET /api/todos?important=true|false` filters on `effectiveImportant` and is
   served from the one cached `todo:all` entry (no key change, one loader call).
7. Cache: `todo:all`/`todo:trash` values carry `important`, `todo:lists` values carry
   `importantDefault`; content fields remain `enc.v1.`-only and the no-known-plaintext
   assertions still pass; a list write bumps `todo:gen:<sub>` once.
8. Concurrency/trash unaffected: `expectedVersion` 409 semantics and the trash/restore
   `version` rule are unchanged by the new field.

## Boundaries

- Always: kernel contracts as written; content columns encrypted; cache values
  ciphertext-only for content; effective importance computed, never stored.
- Ask first: any further field beyond the L6 importance signal (manual urgency,
  configurable urgency windows, recurrence/subtasks remain their own intents).
- Never: encrypt the boolean (it is non-content, mirroring `done`); denormalize the
  effective value onto the todo row; put `important`/`importantDefault` in the cache key;
  run content matching or matrix placement in SQL over encrypted columns; store plaintext
  content in cache or logs.

## Success Criteria

1. `todo.important` and `list.importantDefault` are delivered end-to-end through
   `redis-todo`: the cached row shapes carry both plaintext booleans while every content
   column stays ciphertext-only.
2. `effectiveImportant` is computed post-decrypt as `important ?? importantDefault ??
   false`, so a list-default change reaches all inheriting todos without a write fan-out.
3. `SPEC-todo-service.md`'s todo/list field contracts and `## Cache Rules` include the new
   fields consistently; the cache suite's ciphertext assertions still fail on any content
   plaintext leak.
4. `matrix-ui` can place every todo in a quadrant from `effectiveImportant` + derived
   urgency alone — no additional input.
