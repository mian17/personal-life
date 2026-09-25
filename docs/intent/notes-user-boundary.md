# Intent: note-service per-user boundary

Confirmed 2026-09-26 via interview (`interview-me`, explicit yes).
Build artifacts live in `docs/specs/` — map at `docs/specs/MAP-notes-user-boundary.md`.

## Outcome

Every note belongs to exactly one user — the IdP `sub` from the verified token — and
`note-service` enforces it on every query:

- All existing rows are backfilled to the **oldest user in the identity database**.
- A token with any other `sub` sees an empty list and cannot touch your notes.

## User

Me — single user today, zero experience change. A future second identity gets an empty,
isolated notes list: "admitting someone later is a data change, not a rewrite."

## Why now

The IdP chapter's promise is only true if the data tier carries ownership. Boundary work
is cheapest before the `todo-service` domain lands (architecture intent), and this
boundary was parked inside the future SQLite→Postgres chapter — carved out because it
doesn't need a data-tier change to be worth having now.

## Success

- A token with a different `sub` sees zero notes and cannot read, modify, or delete yours.
- My own usage is byte-for-byte identical — same lists, same behavior, no UI change.
- The backfill is idempotent (stamps only `owner_sub IS NULL` rows), deterministic
  (oldest user in the identity database), and safe (verified backup first).

## Constraint

No new service — the IdP is the identity authority; `sub` is a foreign key, never a
cross-DB join or a call. Stays on SQLite. No UI change. Data safety hard lines: `life.db`
is never written by agents/tests outside the migration, and **the migration script owns
its backup** — first step is a timestamped copy of `life.db`, verified complete before
any write runs; that copy is the documented rollback path.

## Out of scope

Any user/profile service, shared notes or per-note ACLs, the SQLite→Postgres data-tier
migration (this boundary is carved out of it), `todo-service`, and changes to the
human-owned e2e suite.

## Decisions log

- 2026-09-26: **No user service.** Identity vs. profile split: the IdP owns identity;
  "user" everywhere else is the validated `sub` from the token — a foreign key, never a
  join or an RPC. A profile service is justified only when real profile data exists
  (zero rows today), and the `sub` column keeps that future chapter cheap.
- 2026-09-26: **Strict single-owner.** One owner per note; no sharing/ACL model is
  pre-built. A future second user sees an empty list; sharing would be its own chapter.
- 2026-09-26: **Backfill = oldest user in the identity database.** Deterministic rule;
  on production that's the only user, and everything there is theirs. Idempotent:
  `owner_sub IS NULL` rows only — never re-stamps owned rows.
- 2026-09-26: **The migration script owns its backup.** Timestamped `life.db` copy,
  verified complete before any write; backup is the rollback, not a checklist item.
