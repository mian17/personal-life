# Spec: todo-service (standalone todo domain)

Module id: `todo-service` (see `MAP-todo-ecosystem.md`). New workspace app
`apps/todo-service`, mirroring note-service's stack (NestJS + TypeORM better-sqlite3
+ `@life/cache` + `@life/crypto` + IdP JWKS auth).

## Objective

The todo domain: capture and clear todos daily. MVP fields per the confirmed intent
(I2): title, optional note, done toggle, due date — organized by todo-local lists
(I4) and shared tags (TagRef). Contracts are the orchestrator seam (I1).

## Data model

```
todo(
  id        TEXT PRIMARY KEY,        -- service-generated UUID v4
  title     TEXT NOT NULL,           -- enc.v1, AAD life.v1|<sub>|todo|title|<id>
  note      TEXT NULL,               -- enc.v1, AAD life.v1|<sub>|todo|note|<id>
  done      BOOLEAN NOT NULL DEFAULT 0,
  dueDate   DATE NULL,               -- plaintext metadata (sort/filter queries)
  listId    TEXT NULL,               -- FK list.id, ON DELETE SET NULL (detach)
  origin    TEXT NULL,               -- JSON {service,id} — kernel orchestrator seam
  ownerSub  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  deletedAt DATETIME NULL            -- null = active
)
todo_tag(todoId TEXT, tagId INTEGER, PRIMARY KEY(todoId, tagId),
         FOREIGN KEY(todoId) REFERENCES todo(id) ON DELETE CASCADE)  -- TagRefs, no names
list(
  id        TEXT PRIMARY KEY,        -- service-generated UUID v4
  name      TEXT NOT NULL,           -- enc.v1, AAD life.v1|<sub>|list|name|<id>
  ownerSub  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 0,   -- kernel concurrency contract
  createdAt DATETIME NOT NULL
)
user_keys(sub, wrappedDek, kekVersion, createdAt)   -- own key custody (M3)
```

- Content fields (`title`, `note`, `list.name`) encrypted at rest; `dueDate`,
  `done`, timestamps are metadata and stay queryable in SQL (decision: dueDate is
  operational data, not content; documented here deliberately).
- No dual-read (M5). Master key `TODO_MASTER_KEY` (32-byte base64), fail-closed.
- DB wiring: `DB_PATH` env (default `apps/todo-service/data/todo.db` via `@life/shared`'s `resolveDbPath`
  (note-service's split: the service reads `DB_PATH` inline, scripts resolve their
  own vars); compose bind-mounts
  `./apps/todo-service/data:/data` with `DB_PATH=/data/todo.db`.
- Soft delete / trash (user-authorised full soft-delete scope): `deletedAt DATETIME
  NULL` — null = active; `DELETE /api/todos/:id` is a **soft** delete (sets
  `deletedAt`) and the todo stays recoverable from `GET /api/todos/trash`. Trash and
  restore verbs never change `version` (only `update` bumps the OCC counter). No
  separate trash table, no scheduled purge (mirrors `SPEC-notes.md`).

## Behavior / API (kernel contracts apply)

DTO shapes: every mutable entity's DTO carries `version` (todo and list — tags are
registry-owned `TagRef`s, their `version` comes from the registry DTO) so clients
can send `expectedVersion` (kernel concurrency contract). The wire types (`Todo`,
`TodoPage`, `CreateTodoInput`, `UpdateTodoInput`, `List`) are exported from
`@life/shared` (the `Note`/`CreateNoteInput` precedent) — this module owns them;
the app consumes, never re-declares (the orchestrator seam is the wire contract).

- `POST /api/todos {title, note?, dueDate?, listId?, tagIds?}` → 201 (version 0).
- `GET /api/todos?{q, listId, tagId, done, dueBefore, dueAfter}` → cursor page. Cursor payload:
  `base64(<dueDate-or-~>|<createdAt>|<id>)` (`~` = undated sentinel).
  Order: dated by `dueDate ASC` (overdue first), undated last, `createdAt DESC`
  tiebreak. `q` matches decrypted `title`+`note` via `likeMatch` (parity contract
  per kernel); `tagId` filters over `todo_tag`; all content filtering happens after
  cache hits (AGENTS.md Contract 2).
- `GET /api/todos/:id` · `PATCH /api/todos/:id {title?, note?, done?, dueDate?,
  listId?, tagIds?, expectedVersion?}` (409 on stale; omit = last-write-wins) ·
  `DELETE /api/todos/:id` (**soft** delete: sets `deletedAt`).
- `GET /api/todos/trash?{limit, cursor}` → cursor page of soft-deleted todos,
  ordered `deletedAt DESC, id DESC` (cursor payload `base64(<deletedAt>|<id>)`; same
  `limit` rules as the main list) · `DELETE /api/todos/trash` → `{ok: true, count}`
  (empties the caller's trash).
- `POST /api/todos/:id/restore` → clears `deletedAt`, preserving `createdAt`, tags,
  and `version` · `DELETE /api/todos/:id/permanent` → hard-deletes a trashed todo
  (404 if it is not in trash; a failed mutation never bumps the generation).
- **Declare the static `trash` routes before the `:id` routes** (`GET`/`DELETE
  /api/todos/trash` before `GET /api/todos/:id`) so `/trash` is not parsed as an id
  (kernel route-ordering clause, notes precedent).
- Trashed todos are hidden from `GET /api/todos` (list), `GET /api/todos/:id`,
  `PATCH /api/todos/:id`, and `GET /api/todos/tags` (a tag with only trashed todos is
  hidden) — only the trash routes surface them.
- Lists: `POST /api/lists {name}` · `GET /api/lists` · `PATCH /api/lists/:id
  {name, expectedVersion?}` (case-insensitive collision within owner → 409; stale
  `expectedVersion` → 409, omit = last-write-wins) · `DELETE /api/lists/:id` —
  detach semantics: its todos survive with `listId` cleared.
- `GET /api/todos/tags` → `[{tagId, count}]` (kernel usage surface; names resolved
  by the app via the registry). **Declare this route before `GET /api/todos/:id`** —
  Nest matches in declaration order and the literal path must not be shadowed.
- Detach handling (kernel `TagRef` semantics, no S2S): todo-service stores exactly
  the `tagIds` each write carries — updates replace the set (and `todo_tag` rows
  cascade on todo delete); the BFF omits unresolvable ids when rendering.

## Cache Rules (AGENTS.md Contract 2)

- Cached shapes: serialized **ciphertext** todo rows (`todo:all` — the owner's full
  row set; **each row carries its `tagIds`** so the tag filter and counts serve from
  the hit), trash rows (`todo:trash` — the owner's soft-deleted rows serialized
  exactly as stored, each carrying its `deletedAt` and `tagIds`), list rows
  (`todo:lists`), and tag-usage rows (`todo:tags`, metadata-only:
  ids + counts, no ciphertext by design).
- Key composition `todo:<sub>:v<gen>:<rest>` — including `todo:<sub>:v<gen>:trash`.
  `q`/`tagId`/`listId`/`done`/`due*`/ cursor/limit never enter the key — `listId` and
  every other filter are applied in memory off `todo:all` after the hit; one entry
  serves every filter/page variant, and one trash entry serves every trash
  cursor/limit variant.
- Loader guards: the `todo:all` loader (and the `findOne`/`update`/`todo:tags`
  paths) apply `deletedAt IS NULL`, so a generation bump makes a trashed row vanish
  from the list; the `todo:trash` loader applies `deletedAt IS NOT NULL`.
- Per-owner generation counter bumped **after** every successful write — including
  the four trash writes (`remove` soft, `restore`, `removePermanent`, `emptyTrash`)
  on the same `todo:all` counter; a failed mutation never bumps; 60s TTL backstop;
  fail-open on cache errors (direct loader); the fallback path never writes
  plaintext.
- Decrypt, filter, and paginate after every hit. No plaintext in Redis.

## Health

Per `SPEC-service-kernel`: `/health/live`, `/health/ready` (DB + key custody), and
the `/health` deprecated alias (readiness semantics).

## Commands

```
Typecheck: npm run typecheck
Test:      npm run test:unit -w @life/todo-service
Build:     npm run build -w @life/todo-service
```

## Testing Strategy

1. Envelope round-trip: title/note unicode, empty note, large note; raw columns
   start `enc.v1.`; list names too.
2. AAD binding: swap two todos' title ciphertexts → both reads fail closed (ids-only
   log).
3. Search parity: `likeMatch` expectations generated by real SQLite `LIKE` bindings
   over title+note (empirical corpus, incl. user wildcards).
4. Ordering + filters + pagination: due-dated ASC/undated-last, done/`dueBefore`
   filters, cursor continuity (no dup/skip).
5. Lists: rename collision 409; delete detaches todos (they survive).
6. TagRefs: attach/detach by id, dangling-id replacement (a write replaces the
   set; no registry call), `[{tagId, count}]`.
7. Cache: content-bearing shapes (`todo:all`, `todo:lists`) assert `enc.v1.`-only
   serialized values — the `todo:tags` shape is ids+counts metadata by design and
   asserts no plaintext content (no names); gen-counter invalidation; fail-open.
8. Health routes; version/`expectedVersion` 409 semantics.
9. Soft delete / trash: a soft-deleted todo is absent from the list, `GET /:id`
   (404), and tag filters but present in `GET /api/todos/trash`; restore returns it
   with the same `createdAt`, tags, and `version`; permanent delete removes it (and
   its `todo_tag` rows) and 404s on a second call; `DELETE /api/todos/trash` empties
   the caller's trash and returns a `count`; trash/restore never bump `version`.

## Boundaries

- Always: kernel contracts as written; content encrypted; cache values
  ciphertext-only.
- Ask first: adding fields beyond the I2 MVP (recurrence/subtasks/priorities are v2
  and need their own intent; trash was moved out of this list by the user-authorised
  full soft-delete scope).
- Never: store tag names (M1); plaintext in cache or logs; SQL content matching over
  encrypted columns.

## Success Criteria

1. `apps/todo-service` boots with `TODO_MASTER_KEY`; all nine test groups green.
2. A todo created with tags + a list round-trips through cache and cold paths
   identically.
3. `SPEC-todo-ui` can build `/todos` entirely against these contracts.
