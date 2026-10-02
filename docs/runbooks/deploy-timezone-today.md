# Production runbook addendum — client-timezone "today"

Scope: **`df7f58b..2469ad4`** on branch `feat/done-checkmark-undo` (tip **`2469ad4`**).
This delta is `apps/app` + `packages/ui` + one `compose.yaml` env line.

Read this **with** `docs/runbooks/deploy-done-reshape.md` (the reshape, `5157bf1..df7f58b`) and
`docs/runbooks/deploy-completion-custom-repeat.md` (the backend chapters, `8cc6b98..5157bf1`).
A later slice on this branch (`2469ad4..f86e32e`, Done ordering + quadrant tint + debounced
toggles) is in `docs/runbooks/deploy-todos-ux-refinements.md`; deploy that after this one.

**Run by a human. Deploy is a hard line.** This document is the checklist, not authority to run
it. Do **not** merge to `master` unless asked explicitly.

## 0. What changes

"Today" (DueDate state and the Overdue/Today filtering) was decided from the **server** clock;
at 00:24 Vietnam (UTC+7) the UTC server still saw the previous day, so a todo due that local day
read as Tomorrow. The browser now writes its IANA zone to a `tz` cookie; the server computes
`today` in that zone, falling back to `TODO_TIMEZONE` (lesson 0019).

## 1. Migration / env / compose verdict

```bash
git diff --name-only df7f58b 2469ad4 | grep -iE 'migration|schema|\.env'   # empty
git diff --name-only df7f58b 2469ad4 | grep -i compose                     # compose.yaml
```

No migration; no schema change (TypeORM `synchronize: true`). One compose line: the **`app`**
service gains `TODO_TIMEZONE: ${TODO_TIMEZONE:-Asia/Ho_Chi_Minh}` (same expression as
`todo-service`) so the pre-cookie fallback agrees with storage. **Never regenerate a
`*_MASTER_KEY`.**

## 2. Deploy

The compose env change is on `app` only — no backend rebuild is needed for this delta.

```bash
git -C /path/to/personal-life fetch
git -C /path/to/personal-life checkout 2469ad4
cd /path/to/personal-life
docker compose up -d --build app
```

## 3. Verify

- [ ] `docker compose ps` — `app` healthy.
- [ ] Open `/todos` on a device in the user's zone just after local midnight: a todo due that
      local day shows **Today**, not Tomorrow.
- [ ] DevTools → Application → Cookies: `tz` = the browser's IANA zone (e.g. `Asia/Ho_Chi_Minh`).
- [ ] Matrix (`/todos/matrix`) buckets the same local day under **Urgent & Important** when the
      todo is important.

## 4. Rollback

```bash
git checkout df7f58b
docker compose up -d --build app
```

No data, schema, or cache migration is involved, so rollback is image-only.
