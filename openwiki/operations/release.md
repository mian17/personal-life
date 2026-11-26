---
type: "Reference"
title: "Release and promotion"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-f105d25ee8874743173a2232
    resource: repo://.github/workflows/backmerge.yml
  - id: openwiki-source-7cb388000c1223c91d227cd5
    resource: repo://docs/ops/backmerge.md
  - id: openwiki-source-dc254d1b5ec3ecc31a3d949f
    resource: repo://docs/runbooks/release.md
  - id: openwiki-source-76478c25db28b99104e23105
    resource: repo://scripts/release.sh
generated: { by: "pi", at: "2026-11-26T10:12:12.781Z" }
---

# Release and promotion

A **release is a tag plus a GitHub release, on the commit you ship**. Promoting
`dev` to `main` records the release line; it does not tag anything. This
distinction exists because it was once violated: `v0.2.1` shipped and the tag
was skipped, then had to be recovered by hand. The procedure is therefore a
script, not a memory — `scripts/release.sh`, run as `npm run release -- <version>`.

## What release.sh does, in order

1. **Five preconditions, each a refusal** (checked before any mutation):
   clean working tree (`git status --porcelain` empty — the notes file must
   already be committed), HEAD is `origin/dev` (or `--ref`), the tag is new
   locally and on origin, `docs/releases/<version>.md` exists and is non-blank,
   and every workflow on that exact SHA is `completed`/`success`.
2. **Bump `package.json`** — one line, proven by `git diff --numstat` reading
   `1 1 package.json`, so the manifest and the tag cannot drift.
3. **Commit** `chore: release v<x>`, then **annotated tag** with the notes file
   as its message.
4. **Open the landing PR.** Direct pushes to `dev` are refused by the repo
   ruleset (`Block default branches`, id 25775908: PR required on
   `~DEFAULT_BRANCH` and `refs/heads/main`, no bypass actors), so the script
   cuts `chore/release-v<x>`, pushes it, and opens a PR into `dev`.
5. **Wait for CI on the bump commit's own SHA, then merge the PR** — with a
   merge commit, never a squash: the annotated tag points at the bump commit,
   and a squash would rewrite the SHA so `dev` never contains what the tag
   names. The wait polls every workflow on the release branch (40 attempts ×
   30s ≈ 20 minutes — `Tests` takes ~9 min, `Compose boot` ~6 min) and refuses
   immediately on any completed non-success. The ruleset requires a PR but no
   status checks, so this gate is the only thing that stops a release landing
   while its own workflows are red. Ancestry is then proven
   (`git merge-base --is-ancestor HEAD origin/dev`).
   `--skip-ci-check` downgrades both CI gates (pre-bump and bump) to a printed
   warning, deliberately, for a release after a flake.
6. **Push the tag, `gh release create`**, then verify all three facts: the tag
   points at local HEAD, origin carries the same tag, and the release record
   exists and is published (a local tag is not a published release).

`--dry-run` checks the preconditions and prints every remaining command without
executing them (it writes only the one-line version bump so the diff is
inspectable). The runbook (`docs/runbooks/release.md`) carries the notes house
style — an opener that reads on its own, a measured size line, prose sections
that name each failure and its cause, a verification block of real numbers.

## Promotion is a separate act

Promotion is a human decision: open a PR `dev` → `main` (title
`release: promote dev to main (…)`), squash-merge it, and let `backmerge.yml`
open the bookkeeping PR (`-s ours`, keeping dev's tree) that restores `main` as
an ancestor of `dev` so the next promotion does not conflict. Merge that one
with a merge commit. Neither act performs the other:

- A promotion with no tag is **not a release**.
- A release does not deploy anything; deploys are their own runbook
  ([Deployment and operations](deployment.md)).

## Version notes live in git

`docs/releases/<version>.md` must exist and be committed before the script runs.
A version with a promotion but no tag is a gap in the record — v0.2.2 was one,
and its notes were removed rather than back-dated (tags read v0.2.1 → v0.2.3).

## See also

- [CI gates](ci-gates.md) — the workflows preconditions 1 and 5 read.
<!-- openwiki: broken internal link [../openwiki/quickstart.md] file "../openwiki/quickstart.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](../openwiki/quickstart.md) — where to start for other tasks.
