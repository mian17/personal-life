# Production runbook addendum — Done reshape (on top of completion-history + custom-repeat)

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

Scope: **`5157bf1..df7f58b`** on branch `feat/done-checkmark-undo` (tip **`df7f58b`**).
This delta is **`apps/app` + `packages/ui` only** — no backend, no schema, no env.

Read this **with** `docs/runbooks/deploy-completion-custom-repeat.md`, which documents the
backend chapters (`todo_completion` table, `GET /api/todos/completions`, `repeatDays`,
custom repeat) in `8cc6b98..5157bf1`. Nothing in that backend part changes here.
A later slice on this branch (`df7f58b..2469ad4`, client-timezone "today" + a `compose.yaml`
env line on `app`) is in `docs/runbooks/deploy-timezone-today.md`; deploy that after this one.

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it. Do **not** merge to `master` unless asked explicitly — building the
images from the branch is a separate, sufficient step.

## 0. What changes

The `/todos` surface is reshaped (all app-side):

1. **One list, Overdue → Today → Done.** The `/todos` heading and tab are **`Today`**; the
   Status/Tags/Lists filter chrome and the search box are gone.
2. **Open `later`/undated todos are hidden** until they come due (`groupTodos` keeps only
   `overdue`/`today` for open rows; a done row wins over its due bucket).
3. **Done is one row type.** Every Done row — a done one-off and a repeating todo's completed
   occurrence — renders through the same `TodoItem` / `ListItem variant="todo" done` (muted +
   struck, filled left toggle to reopen/undo, no trash). The repeating occurrence shows the
   **due date the tick satisfied**, and its next occurrence stays open in Overdue/Today
   (Apple-Reminders flow, lesson 0017).
4. **Matrix** heading and tab are **`Matrix`**; the matrix is open-only (done todos excluded),
   the rule owned upstream by `groupByQuadrant`.
5. **Tick feedback:** a tick strikes/mutes the row in place, lingers, then relocates it to Done
   (list) or unmounts it (matrix).

```bash
git log --oneline 5157bf1..df7f58b          # the reshape slices
git diff --name-only 5157bf1 df7f58b        # apps/app + packages/ui + docs only
```

**Deploy ref: `df7f58b`.**

## 1. Migration / env / compose verdict — none (this delta)

```bash
git diff --name-only 5157bf1 df7f58b | grep -iE 'compose|\.env|migration|schema'   # empty
```

No migration files exist and schema is created at boot by TypeORM `synchronize: true`; this
delta touches neither. No `.env` name was added, removed, or changed. **Never regenerate a
`*_MASTER_KEY`.**

## 2. Pre-flight

- [ ] Working tree clean and on the deploy ref: `git status --short && git log -1 --oneline`
      → clean, `df7f58b`.
- [ ] Record the images you are about to replace (your rollback target):

      docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life

- [ ] Baseline health: `docker compose ps` (app 3002, idp 3003 on loopback, services
      3001/3004/3005 internal; `/health/ready`).
- [ ] Decide the path you are on:
  - **Production still at `8cc6b98`** (backend not yet deployed): the backend chapters in
    `deploy-completion-custom-repeat.md` are also pending. Building at `df7f58b` includes
    both, so run **that** runbook's §1–3 (backup → `up -d --build app todo-service`), then
    use §4 below for the reshape verification.
  - **Backend already at `5157bf1`** (only the reshape pending): this is an **app-only**
    rebuild — no backup required, no `todo-service` rebuild.

## 3. Boot

- [ ] Backend pending (from `8cc6b98`):

      docker compose down                       # NO -v
      npm run db:backup -w @life/db -- --pin    # all snapshots quick_check=ok
      docker compose up -d --build app todo-service

- [ ] Backend already deployed → app only:

      docker compose up -d --build app

- [ ] `docker compose ps` — `app` healthy.
- [ ] `docker compose logs app --since 2m` — no build/render error on `/todos` or
      `/todos/matrix`.

## 4. Verify — the reshape

On `/todos`:

- [ ] Heading and tab read **`Today`**. The tab default on both `/todos` and `/todos/matrix`
      is **`Today`** (`Matrix` on the matrix surface). No search box, no Status/Tags/Lists
      filter chrome.
- [ ] The list is one ordered list: **Overdue → Today → Done**.
- [ ] A todo due **later** (or undated) is **not shown** until it comes due.
- [ ] **Done has one row type.** Every Done row is struck + muted with a filled left toggle,
      **no trash control** — including a repeating todo's completed occurrence. There is no
      plain/un-struck row and no separate completion component.
- [ ] A done row's meta shows the **due date** (muted, not red) and the toggle is **checked**.
- [ ] Tap a Done row's filled toggle → the row reopens and moves to Today/Overdue.
- [ ] Tick a **repeating** todo → the occurrence lands in **Done** *and* the next occurrence
      stays open in Overdue/Today. Tick a **one-off** → it appears in Done.
- [ ] Tick any todo → the row strikes/mutes **in place**, lingers, then relocates (list) /
      unmounts (matrix). No snackbar regression: `Task completed` / `Undo` still appears and
      the durable Done-row toggle still undoes after the snackbar expires.

On `/todos/matrix`:

- [ ] Heading and tab read **`Matrix`**; quadrants render; the two scale modes still render.
- [ ] Done todos do **not** appear in any quadrant (open-only).

Regressions this delta can touch (shared `@life/ui` + the todo row):

- [ ] `/todos` create → edit → save; due/repeat `Select` dropdowns still save.
- [ ] Row-action `Menu` (rename/delete) still opens and is not clipped.
- [ ] `/todos` trash flow (soft delete / restore) still works.
- [ ] `/notes` create → open → save → trash → restore (untouched; smoke only).

## 5. Rollback

- [ ] **Code:** check out the previous ref and rebuild the image(s) you moved:

      git checkout 5157bf1                       # app-only delta
      docker compose up -d --build app

      # if you also deployed the backend chapters, roll the whole thing back:
      git checkout 8cc6b98
      docker compose up -d --build app todo-service

- [ ] **Data: no restore needed for the reshape.** It is presentation-only; existing
      completion rows and todos are read as-is. (If you also deployed the backend and must
      discard completion rows, follow `deploy-completion-custom-repeat.md` §5.)
- [ ] Stale cache after a rollback: `docker compose restart todo-service` (generation is
      bumped on write; TTL is the backstop).

## Gate status / evidence

- Backend chapters (`todo-completion-history`, `todo-custom-repeat`) — five-lane **N/N PASS**
  (`tasks/five-lane-todo-completion-history.md`, `tasks/five-lane-todo-custom-repeat.md`).
- **Done reshape** — went the small-UI-fix path (lesson 0015): targeted `npm run typecheck`
  (`@life/app`, `@life/ui`) plus the scoped jest suites (`todo-item`, `list-item`,
  `todo-groups`, `routes-matrix`, `matrix`, `routes-todos-list`), and the Contract-1
  mechanical greps (raw HTML / `next/link` / raw colors). **Not** a five-lane gate. The
  reshape itself modified no E2E suite; the `/todos` heading rename left
  `journey.suite.ts:160` stale at deploy time and it was later synced to `Today` with
  explicit approval (`0de75df`, frozen selector surface).

## Hard lines

No one else does these: `docker compose down`, `db:backup`, `db:restore`, `docker compose up`
against production, and any merge to `master`.

## Related

- Backend chapters runbook: `docs/runbooks/deploy-completion-custom-repeat.md`
- Larger older deploy: `docs/runbooks/production-deploy.md`
- Surfaces: `docs/specs/SPEC-todo-ui.md`, `docs/specs/SPEC-matrix-ui.md`,
  `docs/specs/SPEC-todo-completion-history.md`
- Lessons: `docs/lessons/0015-small-changes-skip-the-workflow-gate.md`,
  `docs/lessons/0017-follow-apple-reminders-flow.md`,
  `docs/lessons/0018-one-shared-row-not-a-sibling-component.md`
