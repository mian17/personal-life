---
name: arch-boundary
description: Review a branch for architecture-boundary violations in this repo — database-per-service, engine designation, and cross-service store access, plus the cache-before-db and ciphertext-in-cache judgment calls. Use when reviewing a branch or worktree, or when someone asks whether a change breaks the architecture, the worktree boundary, the one-database-per-service rule, or the cache-before-db layering.
---

# Architecture boundary review

Two halves: a script that proves the mechanical rules, and a reader that answers the
two questions a script cannot.

## 1. Run the script

From the repo root, against the branch's worktree:

```bash
node scripts/arch-check.mjs --worktree .pi/worktrees/<slug> --base origin/dev
```

Exit codes: `0` clean, `1` violations, `2` bad usage or a `git` call that could not
answer. `--json` prints `{findings: [{file, line, rule, message}], ok}` for a tool.

- **rule 3 — one database per service.** Two services resolving to the same host bind
  path, the same SQLite file inside it, or the same Postgres database name; or an
  `apps/<name>-service` directory with no store at all.
- **rule 4 — the designated engine.** SQLite everywhere except
  `POSTGRES_SERVICES` in the script. Adding an entry there is a human decision.
- **rule 5 — no cross-service reach.** A newly added line importing another
  `apps/*-service` source, or naming another service's database file. Diff-scoped, so
  a pre-existing import on the base ref is not this branch's fault.

Read a finding as `file:line — rule N — message`. Exit `1` means the branch is not
reviewable as-is: quote the findings and stop.

## 2. Rule 1 — does every read flow go through the cache?

Read the diff for `apps/*/src`. For each **read** path it adds or changes, ask: does the
fetch go through a `getThrough` loader (`packages/cache/src/index.ts`) rather than a
TypeORM repository? Direct repository use is legitimate on **write** paths and for
**by-id reads** — the reference implementation is
`apps/todo-service/src/todos/todos.service.ts`, and judging it the other way would fail
its own pattern. A list/filter/paginated read that calls a repository directly is the
violation.

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
