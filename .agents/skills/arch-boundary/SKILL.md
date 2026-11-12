---
name: arch-boundary
description: Review a branch for architecture-boundary violations in this repo — database-per-service, engine designation, and cross-service store access, plus the cache-before-db and ciphertext-in-cache judgment calls. Use when reviewing a branch or worktree, or when someone asks whether a change breaks the architecture, the worktree boundary, the one-database-per-service rule, or the cache-before-db layering.
---

# Architecture boundary review

Two halves: a script that proves the mechanical rules, and a reader that answers the
two questions a script cannot.

## 1. Run the script

`--worktree` takes the path of the branch's worktree as the shell spells it from where
you stand, and worktrees live under the **base checkout's** `.pi/worktrees/`. Running
`--worktree .pi/worktrees/<slug>` from inside a worktree therefore points at
`<worktree>/.pi/worktrees/<slug>`, which does not exist and exits `2`. Either run from
the base checkout root, or pass an absolute path:

```bash
git -C <base checkout> worktree list              # the slug → path map
node scripts/arch-check.mjs --worktree <absolute worktree path> --base origin/dev
```

`--base` defaults to `origin/dev`, so it can be omitted when that is the branch base.
The script must exist on the branch you run `node` from; it is not on `dev` until this
change lands, so run it from the branch under review, not from the base checkout.

Exit codes: `0` clean, `1` violations, `2` bad usage or a `git` call that could not
answer. `--json` prints `{findings: [{file, line, rule, message}], ok}` for a tool.

- **rule 3 — one database per service.** Two services resolving to the same mount
  (bind directory or named volume), the same SQLite file inside it, or the same
  Postgres database name; or an `apps/<name>-service` directory with no store at all.
  A Postgres app that compose gives no server to is reported by both rule 3 (no store
  resolves) and rule 4 (the engine is not allowlisted). That is one mistake seen from
  two angles, not two: rule 3's message names the missing postgres server.
- **rule 4 — the designated engine.** SQLite everywhere except
  `POSTGRES_SERVICES` in the script. Adding an entry there is a human decision.
- **rule 5 — no cross-service reach.** A newly added line importing another
  `apps/*-service` source, or naming another service's database file. Diff-scoped, so
  a pre-existing import on the base ref is not this branch's fault. A line that is
  entirely a comment is not judged: naming a path in prose is documentation, not
  access. A trailing comment after live code still is.

Read a finding as `file:line — rule N — message`. Exit `1` means the branch is not
reviewable as-is: quote the findings and stop.

## 2. Rule 1 — does every read flow go through the cache?

Read the diff for `apps/*/src`. For each **read** path it adds or changes, ask: does the
fetch go through a read-through loader — `getThrough` from `packages/cache/src/index.ts`,
or a service's own adapter over it (`getAllThrough` in `apps/tags-service`) — rather
than a TypeORM repository? `apps/idp` is the one service with its own hand-written
read-through cache (`apps/idp/src/users/users-cache.ts`) instead of `@life/cache`; it
still qualifies, and it is not what a `@life/cache` grep would show you.

Direct repository use is legitimate on **write** paths and for **by-id reads**. The
reference implementation is `apps/todo-service/src/todos/todos.service.ts`, but note
that it serves its own by-id read through the cache (`findOne` → `rawRows`), so it is
not the place to see the exemption used. The by-id repository reads that are legitimate
look like `assertOwnedList` in `apps/todo-service/src/lists/lists.service.ts` and the
reminder sweep's due query in `apps/todo-service/src/reminders/reminder.service.ts` — a
point lookup or a background scan that no cache entry serves. A list/filter/paginated
read that calls a repository directly is the violation.

## 3. Rule 2 — is what reaches the cache a serialized row?

Ask whether anything **newly written** to Redis is a decrypted DTO instead of the row as
persisted. For content-bearing services that means an `enc.v1.` envelope: a cached value
that carries a plaintext field where the DB holds ciphertext is a data-privacy breach
(Redis is AOF-persistent), not an optimization. A `cacheable` hook that lets a
plaintext row through is the same violation.

## 4. Verdict

End the review with exactly this shape:

```
script: PASS/FAIL (N findings)
rule 1: <pass/fail> — one sentence of evidence
rule 2: <pass/fail> — one sentence of evidence
```
