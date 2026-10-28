# Back-merge `main` -> `dev`

`.github/workflows/backmerge.yml` opens the recurring `main -> dev` back-merge PR, so the
maintainer never has to run git locally for it.

- **When it fires:** every push to `main` (a promotion landing) and on `workflow_dispatch`.
  If `main` is already an ancestor of `dev` it exits as a no-op, so re-runs are safe.
- **What it does:** merges `origin/main` into `dev` with `git merge -s ours`, proves the tree is
  byte-identical to `dev` and the merge commit has two parents, then opens a PR against `dev`.
  Known intentional deletions (`packages/ui/src/styles/atoms.css`, `blocks.css`) are allowlisted;
  any other file on `main` but missing from `dev` turns the PR into a draft with the paths listed.
- **Why `-s ours` is safe here:** promotions `dev -> main` are squash-merged, so `main` holds no
  content that `dev` does not. The merge is pure bookkeeping — it makes `main` an ancestor of `dev`
  again so the next promotion PR stops conflicting textually. `dev` stays the source of truth.
- **Merge the PR with "Create a merge commit", never squash** — squashing it recreates the problem.
- The back-merge commit is content-neutral, so `sonarqube.yml` detects it by tree comparison and
  skips the scan — there is nothing to analyse.
**Precondition: the repo must allow Actions to open pull requests.** Settings → Actions → General →
Workflow permissions → "Allow GitHub Actions to create and approve pull requests" must be enabled.
The workflow's `GITHUB_TOKEN` carries `pull-requests: write`, but that permission is meaningless
while the repo setting is off. Without it the failure is easy to misread: the branch push succeeds
and only the PR creation is refused (HTTP 403), so the run ends with an orphaned branch and no PR.
The job summary then carries the API's response body, the compare link and the ready-to-paste PR
title and body, so a human can open the PR by hand in a few seconds.

- **The one thing that breaks it:** a hotfix committed straight to `main`, bypassing `dev`.
  `-s ours` would drop it from `dev`'s tree, and if it only edits shared files the deletion guard
  cannot see it. Hotfixes must land on `dev` first, then be promoted like everything else.
