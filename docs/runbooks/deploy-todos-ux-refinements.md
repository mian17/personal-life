# Production runbook addendum — Done ordering, quadrant tint, debounced toggles

Scope: **`2469ad4..f86e32e`** on branch `feat/done-checkmark-undo` (tip **`f86e32e`**).
This delta is **`apps/app` only** — no `packages/ui` source, no backend, no schema, no env,
no compose.

Read this **with** `docs/runbooks/deploy-timezone-today.md` (`df7f58b..2469ad4`),
`docs/runbooks/deploy-done-reshape.md` (`5157bf1..df7f58b`) and
`docs/runbooks/deploy-completion-custom-repeat.md` (the backend chapters, `8cc6b98..5157bf1`).
Deploy those first if they are not already live; this slice sits on top.

**Run by a human. Deploy is a hard line.** This document is the checklist; it is not
authority to run it. Do **not** merge to `master` unless asked explicitly.

## 0. What changes

All `/todos` surface, presentation + client behavior:

1. **Done is ordered by tick time, newest first.** Every Done row — a done one-off and a
   repeating todo's completed occurrence — sorts by its **latest logged completion**
   `completedAt` DESC, tie-broken by the completion `id` DESC (mirrors the completion
   log's own order). A Done row with **no** completion entry (legacy data) sinks below
   every timed row, keeping its prior order. Overdue/Today keep service order.
2. **Quadrant tint on Overdue/Today row checkboxes.** A row's left checkbox is coloured by
   its matrix quadrant — urgent & important → `danger`, urgent → `amber`, important →
   `accent`, neither → no tint. **Done rows stay muted and untinted.** Tint belongs on the
   `/todos` list rows only (the matrix draws its own layout).
3. **Toggle writes are debounced (500 ms settle).** Instead of firing on every press, the
   checkbox/switch wait for the user to stop and then send **one** request reflecting the
   final state; toggling back to the server value sends **nothing**. Applies to:
   - the done checkbox on `/todos` **and** `/todos/matrix` (one shared `TodoItem`),
   - the list **"Important by default"** switch (`/todos/lists`),
   - the settings **Eisenhower matrix** switch (`/todos/settings`).

   A pending write is **flushed on unmount**, so a toggle made just before navigating is
   not lost. The optimistic UI is unchanged: a tick still strikes/mutes the row on the
   same press. (Push reminders are deliberately **not** debounced — the notification
   permission prompt needs the original user gesture.)
4. **E2E only:** `journey.suite.ts` now expects the `/todos` heading **`Today`** (was
   `Todos`). Frozen selector surface, changed with explicit approval — no runtime effect.

```bash
git log --oneline 2469ad4..f86e32e           # the refinement slices
git diff --name-only 2469ad4 f86e32e        # apps/app + docs + ui test only
```

**Deploy ref: `f86e32e`.**

## 1. Migration / env / compose verdict — none

```bash
git diff --name-only 2469ad4 f86e32e | grep -iE 'compose|\.env|migration|schema'   # empty
git diff --name-only 2469ad4 f86e32e | grep -E '^packages/ui/src|^apps/todo-service'  # empty
```

No migration, no schema change (TypeORM `synchronize: true`), no `.env` name, no compose
line, no `@life/ui` source change, no backend change. **Never regenerate a `*_MASTER_KEY`.**

## 2. Pre-flight

- [ ] Working tree clean and on the deploy ref: `git status --short && git log -1 --oneline`
      → clean, `f86e32e`.
- [ ] Record the image you are about to replace (rollback target):

      docker images --format '{{.ID}}  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep personal-life

- [ ] Baseline health: `docker compose ps` — `app` healthy on 3002 (`/health/ready`).

## 3. Deploy

App-only rebuild; the previous slices must already be live (this slice assumes their code):

```bash
git -C /path/to/personal-life fetch
git -C /path/to/personal-life checkout f86e32e
cd /path/to/personal-life
docker compose up -d --build app
```

- [ ] `docker compose ps` — `app` healthy.
- [ ] `docker compose logs app --since 2m` — no build/render error on `/todos`,
      `/todos/matrix`, `/todos/lists`, `/todos/settings`.

## 4. Verify

Done ordering — on `/todos`:

- [ ] Tick three different todos in a known order, then look at **Done**: the most recently
      ticked is **first**, oldest last. Order persists across reload.
- [ ] A repeating todo's completed occurrence sorts by **when it was ticked**, and its next
      occurrence stays open in Overdue/Today.
- [ ] (If any legacy done todos predate the completion log) they appear **after** every
      timed Done row.

Quadrant tint — on `/todos` (Overdue/Today rows):

- [ ] Row checkboxes are coloured by quadrant: urgent & important **red**, urgent **amber**,
      important **accent**, neither **uncoloured**. The matrix rows are unchanged.
- [ ] **Done** rows' checkboxes are **muted, never tinted**.

Debounced toggles — on `/todos`, `/todos/matrix`, `/todos/lists`, `/todos/settings`:

- [ ] Rapidly press a todo checkbox several times, then stop → the row strikes/unstrikes
      instantly, and the server is hit **once** after ~0.5 s (watch the Network tab), landing
      on the final state. The row then relocates/unmounts as before.
- [ ] Press once, then press again back to the starting state, quickly → **no request** is
      sent and the row ends where it began.
- [ ] Press a checkbox and navigate away within half a second → the write still lands
      (flush on unmount); the todo is not left unticked.
- [ ] Same one-request-on-settle behavior for the list **"Important by default"** switch and
      the settings **Eisenhower matrix** switch.
- [ ] Snackbar regression: ticking still shows `Task completed` / `Undo` (now once the write
      settles), and Undo reverses it. Push reminders switch is unchanged.

No-regression smoke:

- [ ] `/todos` heading/tab read **`Today`**, one list Overdue → Today → Done; later/undated
      open todos stay hidden.
- [ ] `/todos/matrix` heading reads **`Matrix`**, open-only, both scale modes render.
- [ ] Create → edit → save a todo; due/repeat dropdowns; row menu; trash/restore.
- [ ] `/notes` create → open → save (untouched; smoke only).

## 5. Rollback

- [ ] **Code:** check out the previous ref and rebuild `app`:

      git checkout 2469ad4
      docker compose up -d --build app

- [ ] **Data: no restore needed.** This slice is presentation-only and reads existing
      completion rows/todos as-is; the debounce changes no persisted contract.
- [ ] No cache/backend action; nothing on `todo-service` changed, so no restart is required.

## Gate status / evidence

- Went the **small-UI-fix** path (lesson 0015): targeted `npm run typecheck` (`@life/app`)
  plus scoped jest (`todo-item`, `todo-groups`, `routes-todos-list`, `routes-manager-blocks`,
  `routes-settings`) and the Contract-1 mechanical greps (raw HTML / `next/link` / raw
  colors). **Not** a five-lane gate.
- Independent fresh-context verification passed for the timezone slice; this slice was
  reviewed by the Tech Lead over the integrated diff before the `master` fast-forward.
- The only E2E edit in the slice is the approved frozen-heading assertion; no E2E suite was
  added and none was run.

## Hard lines

No one else does these: `docker compose down`, `db:backup`, `db:restore`, `docker compose up`
against production, and any merge to `master`.

## Related

- Previous slices: `docs/runbooks/deploy-timezone-today.md`,
  `docs/runbooks/deploy-done-reshape.md`, `docs/runbooks/deploy-completion-custom-repeat.md`
- Surfaces: `docs/specs/SPEC-todo-ui.md`, `docs/specs/SPEC-matrix-ui.md`,
  `docs/specs/SPEC-ui-settings.md`, `docs/specs/SPEC-app-kit-settings.md`
- Lessons: `docs/lessons/0015-small-changes-skip-the-workflow-gate.md`,
  `docs/lessons/0019-today-is-the-client-timezone.md`,
  `docs/lessons/0020-quadrant-tint-is-a-rendered-contract.md`
