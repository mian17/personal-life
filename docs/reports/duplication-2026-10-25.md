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
| this branch (`pi/wf/dup-zero`) | 429 | 36 |
| blocks present only on this branch | — | **0** |

58 fewer blocks, nothing new. That last row is the one that matters: an extraction
that removes one clone but introduces another nets nothing, and this is how such a
regression is caught. It caught exactly that during this work — the first
`ManagerSurface` extraction duplicated `TagPicker`'s create field, the scan
reported the new block, and the fix was a real extraction (`CreateField`), not a
waiver.

## What is left, and why

The 36 remaining blocks are outside this goal's seven clusters. They sit in areas
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

## Which blocks actually count on the server

The local proxy is deliberately coarser than SonarQube's CPD, so its 36 is not the server
figure. The authoritative list is the server's own per-file attribution, queried live against
the analysis of `main` (which holds the `dev` tree):

```
get_component_measures(branch=main)
  duplicated_lines=275  duplicated_blocks=14  duplicated_lines_density=0.8  ncloc=24081
  code_smells=2

search_duplicated_files(branch=main)  -> 12 files, 14 blocks
  packages/crypto/src/envelope.ts            17 lines / 1 block
  packages/crypto/src/keys.ts                17 / 1
  packages/ui/src/components/fab-menu.tsx    16 / 1
  packages/ui/src/components/menu.tsx        16 / 1
  packages/db/src/restore.ts                 26 / 1
  packages/db/src/restore-pg.ts              28 / 1
  packages/ui/src/components/list-manager.tsx 41 / 2
  packages/ui/src/components/tag-manager.tsx  41 / 2
  apps/note-service/src/notes/notes.service.ts 23 / 1
  apps/todo-service/src/todos/todos.service.ts 22 / 1
  apps/app/app/(meals)/meals/foods/fields.ts   14 / 1
  apps/app/app/(meals)/meals/entry/[id]/page.tsx 14 / 1
```

Those 12 files are exactly the 12 files of this goal's six extracted pairs (crypto, panel
dismiss, DB probe, tag usage, manager surface, nutrition fields). Every one of the 14 server
blocks is one this branch removes. Confirmed block-by-block with `get_duplications`, e.g.
`notes.service.ts` reported `from=105 size=23` against `todos.service.ts from=228 size=22` —
precisely the `isTagUsageRow` + `decodeTagUsage` pair moved into `packages/shared`.

The meal-service row-mapping, note backfill scripts, and create/update DTO clusters the local
proxy flags are **not** in the server's list: they fall below CPD's token threshold, or the
normalizer treats the mirrored `interface` members as declarations rather than duplicable
statements. So they are not counted against the goal.

One real logic duplicate did sit inside Sonar's own file list — `normalizeTagIds`, byte-identical
in `notes.service.ts` and `todos.service.ts` at ~92 tokens, just under CPD's ~100-token minimum.
It was extracted into `@life/shared` as well (`packages/shared/src/tag-usage.ts`, tests in
`test/normalize-tag-ids.test.ts`) so the server zero does not depend on a threshold.

Post-change, scanning the 12 server files through the local proxy leaves exactly one block:
`packages/shared/src/index.ts:115-134` vs `todos.service.ts:45-54`. That is the public
`UpdateTodoInput` interface next to the internal `TodoPatch` type — a field-shape coincidence,
not logic, and not counted by CPD.
