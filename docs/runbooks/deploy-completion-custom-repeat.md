# Production runbook — todo-completion-history + todo-custom-repeat

Scope: **two chapters** — `8cc6b98..<branch tip>` on `feat/todo-custom-repeat`
(`d288927` when this runbook was written, 64 files; the tip may be later). Both chapters are
five-lane **N/N PASS** (`tasks/five-lane-todo-completion-history.md`,
`tasks/five-lane-todo-custom-repeat.md`).

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it. Do **not** merge to `master` unless you ask for that explicitly —
building the images from the branch is a separate, sufficient step.

## 0. What actually changes (verified 02-Oct, re-check before you run)

Production currently runs ≈ **`8cc6b98`** (`feat/todo-due-repeat-notify`). Evidence:

| Probe | Result | Meaning |
|---|---|---|
| app image `/app/apps/app/.next` → `todos/completions`, `Custom repeat`, `ui-dialog` | 0 | completion history + custom repeat **absent** |
| app image → `todos/matrix`, `Eisenhower`, `ui-menu`, `ui-select`, `Important` | present | matrix, Menu, Select, importance **already live** |
| todo-service image `/app/dist` → `advanceToOnOrAfter` | present | canned repeats + reminders **already live** |
| todo-service image → `todo_completion`, `repeatDays`, `custom repeat requires repeatDays` | 0 | both new chapters **absent** |

```bash
git log --oneline 8cc6b98..HEAD                    # → the chapters + the tick fix + durable Undo
git diff --name-only 8cc6b98 HEAD                  # → 68 at the tip 5157bf1
```

> The repeat-tick **advance + undo** bug (ticked future-dated repeat re-targeted the same
> occurrence, and a repeating row showed no Undo) is fixed on the tip after `d288927`
> (`1e42756`): a tick steps strictly past the completed occurrence, and `done:false` on a
> repeating todo restores it. If you deploy an earlier tip, you ship that bug. Verify with
> `git log --oneline -1`. The runbook's boot/verify/rollback steps are unchanged.

> **Deploy ref: `5157bf1`.** On that tip the server's undo rule is a single "delete this
> todo's newest completion row, restore the due iff the occurrence is a real date" rule, and
> the **Done view carries an icon-only Undo control on each task's newest completion row**
> (so the durable undo still works after the snackbar expires). Tip `d288927` or earlier ships
> neither. Both `app` and `todo-service` change in this delta.

**Correction to the earlier assumption:** Select dropdowns, the importance label, and the
row-actions `Menu` are **already deployed** — they are *not* part of this batch. The
pending set is the two chapters below plus the tick fix and the durable Undo:

1. **completion history** — `todo_completion` table, `GET /api/todos/completions`, the Done view
2. **custom repeat** — `repeatDays` column, `@life/ui` `Dialog`, `RecurrenceDialog`, `Custom (Thu, Fri)`
3. **durable Done-view Undo** — an icon-only Undo control on each task's newest completion row
   (after the snackbar expires), backed by the unified newest-row server undo rule

### Migration verdict — none

No schema/DDL migration files exist; schema is created at boot by TypeORM
`synchronize: true`. Booting `todo-service` **adds** the `todo_completion` table and the
nullable `repeatDays` column. Existing rows are untouched (`repeatDays = null`).
**Ordering: backup → boot. There is no step between them.**

### Env / compose verdict — none

`git diff --name-only 8cc6b98 d288927 | grep -E '^\.env|compose'` → empty. `.env` already
carries every name this stack needs (`TODO_MASTER_KEY`, `TODO_VAPID_*`, `OIDC_AUDIENCE_MAP`,
`*_MASTER_KEY`). Nothing to generate, nothing to edit. **Never regenerate a
`*_MASTER_KEY`** — it is write-once; a new value makes that service's existing rows
undecryptable.

## 1. Pre-flight

- [ ] Working tree clean and on the deploy ref: `git status --short && git log -1 --oneline`
      → clean, `5157bf1`.
- [ ] Record the images you are about to replace (your rollback target):

      docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life

      Known at time of writing — app `ae29b1bd9727` (built `2026-10-02T07:58:35Z`),
      todo-service `5e5b3cd5e446` (built `2026-10-02T06:36:55Z`).
      `note-service`, `idp`, `tags-service` are **not** in this delta — do not rebuild them.
- [ ] Baseline health so you know what "healthy" looked like before: `docker compose ps`
      (every healthcheck green; ports 3002 app, 3003 idp on loopback, services 3001/3004/3005
      internal; health endpoint `/health/ready`).
- [ ] Confirm the two markers you expect to appear after boot:

      docker run --rm personal-life-app:latest sh -lc "grep -rl 'Custom repeat' /app/apps/app/.next | wc -l"      # 0 now
      docker run --rm personal-life-todo-service:latest sh -lc "grep -rl 'repeatDays' /app/dist | wc -l"          # 0 now

      (Use those exact paths: the app image's `/app` is the monorepo root, so `/app/.next`
      does **not** exist — a wrong path silently returns `0` and looks like a valid answer.)

## 2. Stop and back up (destructive-window protection)

```bash
docker compose down            # NO -v : -v also removes redis-app-data (your sessions)
npm run db:backup -w @life/db -- --pin
```

- [ ] All four databases snapshot — `life.db`, `tags.db`, `todo.db`, `idp.db` — and every
      line reports `quick_check=ok`. Do not continue otherwise; rollback depends on it.
- [ ] Backups are readable: `sqlite3 apps/todo-service/data/todo.db 'PRAGMA integrity_check;'` → `ok`.
- [ ] Optional subset form: `npm run db:backup -w @life/db -- --only todo` (this delta only
      writes `todo.db`, but a full pinned snapshot is the safer default).

## 3. Boot

- [ ] Rebuild **only** the two services in the delta:

      docker compose up -d --build app todo-service

- [ ] Ordering is enforced by `depends_on` + healthchecks: Redis → services → `app`. Do not
      rebuild the frontend before its backends are healthy.
- [ ] `docker compose ps` — `todo-service` and `app` healthy.
- [ ] `docker compose logs todo-service --since 2m` — no `synchronize` errors, no
      `repeatDays`/`todo_completion` column errors, no failed healthcheck.

## 4. Verify

New behavior (the two chapters):

- [ ] `/todos` → tick a **repeating** todo → the occurrence lands in the **Done** list *and*
      the row still shows the **next** occurrence (`done` stays open). This is the
      Apple-Reminders flow (lesson 0017); advance-only is a regression.
- [ ] `/todos` → the **Done** section lists each completed task once (struck + muted)
      with no trash control; tap its filled left checkmark → the task reopens in
      Today/Overdue.
- [ ] Unticking a one-off removes only that row.
- [ ] Tick a todo → a `Task completed` / `Undo` snackbar appears
      **immediately** (both shapes) and the row **stays put**. The due
      advances **strictly past** the occurrence it just consumed — including a *future-due*
      row in **Later**: a second tick must record a **different** occurrence, never jam on
      the same one (that jam was bug `1e42756`).
- [ ] Press **Undo** on that snackbar → the occurrence's row vanishes from the **Done** list,
      the due rolls back to it, the reminder re-arms, and the row is still open.
- [ ] Let the snackbar expire, then scroll to the **Done** section → the completed task
      appears as a struck/muted row; tap its filled left checkmark → it reopens (moves to
      Today/Overdue) and leaves Done.
- [ ] Repeat field → `Custom…` → modal opens titled **Custom repeat** with the due date's
      weekday pre-ticked; tick a second day → **Confirm** → the row reads
      `Custom (Thu, Fri)`.
- [ ] Cancel / Escape / clicking outside the modal leaves the committed repeat untouched.
- [ ] Save that custom todo, tick it → a completion is recorded for the pre-advance due, then
      `dueDate` jumps to the next chosen weekday, `reminderScheduledAt` re-arms, and the row
      stays open.
- [ ] `Repeat` field still lists the five canned repeats and behaves exactly as before.
- [ ] Push reminder still fires (`TODO_VAPID_*` are set on this stack).

Regressions this delta can touch (shared `@life/shared` wire types + `@life/ui`):

- [ ] `/todos` list → status pills → tag/list filters → search → create → edit → save.
- [ ] Row-action `Menu` (rename/delete) still opens and is not clipped.
- [ ] Repeat/due `Select` dropdowns still render and save.
- [ ] `/todos/matrix` quadrants still render.
- [ ] `/notes` create → open → save → trash → restore (untouched by this delta; smoke only).

## 5. Rollback

- [ ] **Code:** check out the previous ref and rebuild the two images:

      git checkout <previous-ref>        # e.g. 8cc6b98
      docker compose up -d --build app todo-service

- [ ] **Data: no restore needed for this delta.** It is additive — old code simply ignores
      the `todo_completion` table and the `repeatDays` column, and `CachedTodoRow` is decoded
      with plain `JSON.parse` (no strict schema in `todos.service.ts`), so cache rows carrying
      the extra `repeatDays` key are harmless. **Old code reads the new arrangement safely.**
- [ ] **Data restore only if you must discard the new completion rows** (destructive — it
      overwrites current state). `db:restore` fail-closes on a stack probe of ports
      **3002/3003** (`packages/db/src/restore.ts:33`), so the stack must be stopped first:

      docker compose down                 # NO -v
      npm run db:restore -w @life/db -- --from backup/<dir> --only todo
      docker compose up -d --build app todo-service     # or the previous ref's images

      Valid `--only` names: `life`, `tags`, `todo`, `idp`. There is no down-migration — a
      restore overwrites, so snapshot first if you might want today's state back.
- [ ] If anything looks stale after a rollback: `docker compose restart todo-service` (cache
      generation is bumped on every successful write; TTL is the backstop).

## Hard lines

No one else does these: `docker compose down`, `db:backup`, `db:restore`, `docker compose up`
against production, and any merge to `master`.

## Related

- Lane B (older, larger) deploy: `docs/runbooks/production-deploy.md`
- Backup/restore contract: `docs/specs/SPEC-db-backup-restore.md`
- Chapters: `docs/specs/SPEC-todo-completion-history.md`, `docs/specs/SPEC-todo-custom-repeat.md`
- Known doc debt: `docs/intent/docker-deploy.md:35-45` still describes a two-service stack
  with no migration — treat this runbook as authoritative.
