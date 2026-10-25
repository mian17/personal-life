# Duplication: what this branch changed, and how to check it

SonarQube Community Edition keeps a single analysis per project and the workflow
scans only `dev` (`.github/workflows/sonarqube.yml`). A branch therefore cannot
show its own duplication figure before merge: dispatching a scan on the PR branch
would write unmerged code into the one analysis slot that `main`'s numbers come
from. So the measurement below is local, reproducible and committed.

## The measurement

```bash
# from the repo root, against the base checkout (origin/dev content)
python3 scripts/duplication-report.py /path/to/personal-life

# base checkout vs this worktree: prints both counts and any block that only
# exists after the change (a regression)
python3 scripts/duplication-report.py /path/to/personal-life .
```

`scripts/duplication-report.py` slides a 10-line window over product code, hashes
each normalized window, and reports windows that occur in more than one file.
Tests, `docs/`, `dist/`, `node_modules/` are excluded, mirroring
`sonar.cpd.exclusions`.

It is deliberately coarser than SonarQube's CPD, which also ignores imports and
coalesces overlapping windows — that is why its absolute count is higher than the
server's. Use it as a **relative** before/after measure, never as the server
figure.

## Result for this branch

Captured in `docs/reports/duplication-2026-10-25.txt`:

| tree | product files | duplicate 10-line blocks |
|---|---|---|
| base checkout (`origin/dev`) | 424 | 94 |
| this branch (`pi/wf/dup-zero`) | 429 | 37 |
| blocks present only on this branch | — | **0** |

57 fewer blocks, nothing new. That last row is the one that matters: an extraction
that removes one clone but introduces another nets nothing, and this is how such a
regression is caught. It caught exactly that during this work — the first
`ManagerSurface` extraction duplicated `TagPicker`'s create field, the scan
reported the new block, and the fix was a real extraction (`CreateField`), not a
waiver.

## What is left, and why

The 37 remaining blocks are outside this goal's seven clusters. They sit in areas
where the duplication is either structural or already scheduled:

- `apps/meal-service/src/{entries,foods,saved-meals}` — the three services share
  row-mapping and cache-loader shape; extracting a shared owner for them is a
  backend refactor with its own spec, not a duplication sweep.
- `apps/note-service/scripts/*` — one-off backfill scripts that must keep working
  against old schemas; sharing code between them couples two migrations that
  should stay independently re-runnable.
- `apps/todo-service/src/todos/dto/*` — `create`/`update` DTOs mirror each other by
  design, as Nest validation classes.
- `packages/ui/src/components/manager-block.tsx` ↔ `trash-block.tsx` — one shared
  row block, candidate for the same treatment as the manager surface.

Each is a separate change with its own review; none is a regression from this
branch.
