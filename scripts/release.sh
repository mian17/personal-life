#!/usr/bin/env bash
# release.sh — tag a release, push the tag, create the GitHub release, prove all three.
#
# Why this exists. Releases here were tagged by hand, from memory, and the tag step
# was skipped more than once: `v0.2.1` shipped and a later conversation had to
# revisit "you forgot the tag". Nothing in the repo encoded the procedure — no
# release script, no release workflow, no release runbook — so it lived only in
# chat and died at the next compaction. A merged promotion is NOT a release; the
# tag and the GitHub release are. This makes that mechanical and checkable instead
# of remembered.
#
# Five preconditions, each a refusal and not a warning, all checked BEFORE any
# mutation. Every refusal names the fix, because a guard nobody can act on is the
# same as no guard:
#
#   1. clean tree            `git status --porcelain` is empty.
#   2. HEAD is origin/dev    after `git fetch origin --prune`, unless --ref names
#                            another ref. You deploy from `dev` (the deploy runbook
#                            pins no hash), so a tag anywhere else tags something
#                            nobody ships.
#   3. the tag is new        absent locally and on the remote.
#   4. the notes file exists and is not blank (`docs/releases/<version>.md`,
#                            or --notes <path>).
#   5. CI is green on the    for EVERY workflow reporting on that exact headSha:
#      exact SHA             status == completed and conclusion == success.
#                            `gh run list --commit <sha>` returns nulls in this
#                            repo, so the list is filtered by headSha instead.
#
# Then, in order, each verified before the next: bump root package.json's version
# (so the tag and the manifest cannot drift) → annotated tag carrying the notes as
# its message → land the bump commit through a pull request → push the tag →
# create the GitHub release → verify.
#
# Precondition 5 is not enough on its own, because it measures the PRE-bump HEAD.
# Nothing about a green `dev` says the bump commit's own workflows pass, and the
# ruleset requires a pull request but no status checks — so after the release PR
# opens, the script waits for every workflow on the bump commit's own SHA to be
# `completed`/`success` before it merges. That wait is a refusal, not a warning:
# without it a release lands while its own tests are still queued, running or red.
#
# The bump commit cannot be pushed to `dev`. The repository ruleset `Block default
# branches` (id 25775908) targets `~DEFAULT_BRANCH` and `refs/heads/main`, requires
# a pull request on both, and has no bypass actors — so a direct `git push` to
# `dev` is refused with GH013 "Changes must be made through a pull request." The
# commit lands the way v0.2.3 landed by hand: branch `chore/release-v<version>` →
# `gh pr create --base dev` → `gh pr merge --merge`, then the tag. Always a merge
# commit, never a squash: squashing rewrites the SHA, and the annotated tag is
# already created on the bump commit, so a squashed `dev` would never contain the
# commit the tag names.
#
# The notes file must already be COMMITTED: precondition 1 is a genuinely empty
# `git status --porcelain`, and an uncommitted notes file is a dirty tree. It must
# also already be on `dev`, which means its own pull request — the same ruleset
# applies to it.
#
# Usage: npm run release -- <version> [flags]        (e.g. npm run release -- 0.2.3)
# Run it on `dev`, clean and level with `origin/dev`: the script cuts
# `chore/release-v<version>` from the bump commit and merges that PR into `dev`.
#
# Flags:
#   --notes <path>     notes file to use instead of docs/releases/<version>.md
#   --ref <ref>        tag this ref instead of origin/dev (must still be clean)
#   --title <title>    release title instead of "v<version> — <first heading>"
#   --skip-ci-check    downgrade BOTH CI gates to a printed warning and continue:
#                      precondition 5 on the pre-bump HEAD, and the wait on the bump
#                      commit's own workflows. Both print the evidence they ignored
#                      and say the gate was not enforced. Use deliberately: a
#                      release after a flake must stay possible.
#   --dry-run          check the preconditions, then print every remaining command.
#                      No commit, no tag, no push, no release. The ONE thing it does
#                      write is the package.json version line, so the one-line diff
#                      is inspectable; it prints the revert command.
#   --help             this page. It is the one someone reads at 11pm.
#
# Recovery, by half-state (the script prints the matching line when a step fails):
#   commit missing    → git commit -m "chore: release v<x>" -- package.json
#   tag not created   → git tag -a v<x> -F <notes>
#   branch not pushed → git push -u origin chore/release-v<x>
#   no PR opened      → gh pr create --base dev --head chore/release-v<x> \
#                       --title "chore: release v<x>"
#   PR open, CI not   → the release PR is open and the bump commit's workflows are
#   green               red or still running; nothing merged, nothing tagged. Watch
#                       them with `gh run list --branch chore/release-v<x>`, fix and
#                       push to that branch, then rerun the release.
#   PR open, unmerged → gh pr merge <n> --merge --subject "chore: release v<x> (#<n>)"
#                       (never --squash: the tagged commit must stay on dev)
#   tag local, not    → tag exists locally but not on the remote; retry with
#   on the remote       `git push origin v<x>`
#   no release record → tag is on the remote, no release record; retry with
#                       `gh release create v<x> --title … --notes-file <notes>`
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- helpers ----------------------------------------------------------------

refuse() { printf 'refuse: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
usage() { sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

require_version() {
  [ -n "${1:-}" ] || refuse "no version given. Usage: npm run release -- 0.2.2"
  [[ "$1" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || refuse "'$1' is not a version. Use <major>.<minor>.<patch>, e.g. 0.2.2"
  printf '%s' "${1#v}"
}

require_clean_tree() {
  local dirty
  dirty=$(git status --porcelain)
  [ -z "$dirty" ] || refuse "working tree is dirty; commit or stash first. Dirty paths:
$dirty"
}

require_head_is_ref() {
  local head ref_sha
  head=$(git rev-parse HEAD)
  ref_sha=$(git rev-parse --verify --quiet "$REF^{commit}") || refuse "$REF does not resolve to a commit. Fetch it first: git fetch origin --prune"
  if [ "$head" != "$ref_sha" ]; then
    refuse "HEAD is $head but $REF is $ref_sha. Tag the ref you ship: git pull --ff-only origin dev (or pass --ref <ref>)"
  fi
}

require_new_tag() {
  local tag="v$V" local_sha remote_line remote_sha
  if local_sha=$(git rev-parse --verify --quiet "refs/tags/$tag"); then
    refuse "$tag already exists at $local_sha. Pick the next version: git tag -l 'v*' | sort -V | tail -1"
  fi
  remote_line=$(git ls-remote --tags origin "refs/tags/$tag")
  if [ -n "$remote_line" ]; then
    remote_sha=$(printf '%s' "$remote_line" | awk '{print $1}')
    refuse "$tag already exists at $remote_sha (on origin; not fetched locally yet)"
  fi
}

require_notes() {
  [ -f "$NOTES" ] || refuse "write the notes first: $NOTES"
  [ -n "$(tr -d '[:space:]' <"$NOTES")" ] || refuse "write the notes first: $NOTES is empty"
}

# One gh call, and its --jq does the headSha filtering: `--commit <sha>` returns
# nulls in this repo, so the run list is filtered by headSha instead. Emits
# "none", or one TSV line per workflow reporting on that exact SHA.
#
# The branch is a parameter because a SHA has no branch. It is `dev` while the
# pre-bump HEAD is checked, and the release branch once the bump commit is pushed:
# `gh run list --branch <ref>` does list the runs of a pushed PR head branch, so
# the one implementation serves both.
ci_report() {
  local sha="$1" branch="$2"
  gh run list --branch "$branch" --limit 100 \
    --json headSha,workflowName,status,conclusion,url \
    --jq "[.[] | select(.headSha == \"$sha\")] | if length == 0 then \"none\" else (.[] | \"\(.workflowName)\t\(.status)\t\(.conclusion)\t\(.url)\") end"
}

require_ci_green() {
  local sha="$1" branch="$2" report name status conclusion url failed=""
  report=$(ci_report "$sha" "$branch") || refuse "could not read CI runs from GitHub (gh run list failed). Check gh auth, or use --skip-ci-check deliberately"
  if [ "$report" = none ]; then
    refuse "no CI run reports on $sha (branch $branch). Push the commit and wait for CI, or pass --skip-ci-check deliberately"
  fi
  while IFS=$'\t' read -r name status conclusion url; do
    [ -n "${name:-}" ] || continue
    if [ "$status" != completed ] || [ "$conclusion" != success ]; then
      failed+="  $name — $status/$conclusion — $url"$'\n'
    fi
  done <<<"$report"
  if [ -n "$failed" ]; then
    refuse "CI is not green on $sha:
$failed""  Fix the workflow and push again, or pass --skip-ci-check deliberately"
  fi
  printf 'CI green on %s: %s\n' "$sha" "$(printf '%s' "$report" | cut -f1 | paste -sd ', ' -)"
}

# Every workflow on that SHA, printed as evidence, no verdict. The downgrade path.
print_ci_evidence() {
  local sha="$1" branch="$2" report
  report=$(ci_report "$sha" "$branch") || report="(gh run list failed)"
  printf 'CI evidence for %s (branch %s), NOT enforced:\n' "$sha" "$branch"
  if [ "$report" = none ]; then
    printf '  no run reports on this SHA\n'
  else
    printf '%s\n' "$report" | awk -F'\t' '{printf "  %s — %s/%s — %s\n", $1, $2, $3, $4}'
  fi
}

# --- mutations --------------------------------------------------------------

# A minimal, surgical edit: only the "version" field is rewritten, the file is
# re-serialised with the 2-space indent it already uses. The numstat check is the
# proof — a formatter that touched anything else aborts the release instead of
# committing an unrelated reformat.
bump_manifest_version() {
  node -e '
    const fs = require("node:fs");
    const path = "package.json";
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    pkg.version = process.argv[1];
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$V"
  local stat
  stat=$(git diff --numstat -- package.json | awk '{print $1, $2, $3}')
  [ "$stat" = "1 1 package.json" ] || refuse "package.json edit touched more than the version line ($stat). Revert with: git checkout -- package.json"
  git diff --stat -- package.json
}

release_title() {
  if [ -n "$TITLE" ]; then
    printf '%s' "$TITLE"
    return
  fi
  local heading
  heading=$(grep -m1 '^[#]' "$NOTES" || true)
  heading=${heading##*#}
  heading=${heading# }
  heading=$(printf '%s' "$heading" | sed -E 's/^v?[0-9]+(\.[0-9]+)*[[:space:]]*—[[:space:]]*//')
  if [ -n "$heading" ]; then printf 'v%s — %s' "$V" "$heading"; else printf 'v%s' "$V"; fi
}

create_bump_commit() {
  step "commit the version bump"
  git add package.json
  if ! git commit -q -m "chore: release v$V" -- package.json; then
    printf 'failed at: commit the version bump.\n  state: package.json is bumped and staged; no commit, no tag, no push, nothing on the remote.\n  recover: git commit -m "chore: release v%s" -- package.json\n' "$V" >&2
    exit 1
  fi
  git log --oneline -1
}

create_tag() {
  step "tag v$V (annotated, message = the notes)"
  if ! git tag -a "v$V" -F "$NOTES"; then
    printf 'failed at: create the annotated tag.\n  state: the bump commit exists locally; no tag, no push, nothing on the remote.\n  recover: git tag -a v%s -F %s\n' "$V" "$NOTES" >&2
    exit 1
  fi
  printf 'tagged %s at %s\n' "v$V" "$(git rev-parse HEAD)"
}

# `dev` does not accept a push: ruleset `Block default branches` (25775908)
# requires a pull request on `~DEFAULT_BRANCH` and `refs/heads/main` and has no
# bypass actors, so pushing the branch a release commit sits on fails with GH013
# no matter who runs it.
#
# The bump commit lands through a PR instead, on the branch v0.2.3 landed on by
# hand: `chore/release-v<version>` → `gh pr create --base dev` → `gh pr merge
# --merge`. The tag is pushed afterwards, so a landing that never happened leaves
# a local tag and nothing on the remote — recoverable, not silent.

# A squash merge rewrites the commit, and the annotated tag already points at the
# bump commit; `dev` would then never contain the SHA the tag names. The body says
# so, because the reviewer is the one who picks the merge strategy.
release_pr_body() {
  printf 'Version bump for v%s, with the notes in %s.\n\n' "$V" "$NOTES"
  printf 'Merge this with a **merge commit**. Never squash it: tag v%s is created on\n' "$V"
  printf 'the bump commit %s and has to stay reachable from `dev`, which a\n' "$(git rev-parse HEAD)"
  printf 'squash would break by rewriting the SHA. The SHA must not change.\n'
}

require_release_branch_is_new() {
  local local_sha remote_line remote_sha
  if local_sha=$(git rev-parse --verify --quiet "refs/heads/$RELEASE_BRANCH"); then
    printf 'failed at: create the release branch.\n  state: the bump commit and tag v%s exist locally; %s already exists at %s; nothing was pushed.\n  recover: git branch -D %s (stale branch), then rerun the release\n' \
      "$V" "$RELEASE_BRANCH" "$local_sha" "$RELEASE_BRANCH" >&2
    exit 1
  fi
  remote_line=$(git ls-remote --heads origin "refs/heads/$RELEASE_BRANCH")
  if [ -n "$remote_line" ]; then
    remote_sha=$(printf '%s' "$remote_line" | awk '{print $1}')
    printf 'failed at: create the release branch.\n  state: the bump commit and tag v%s exist locally; %s already exists on origin at %s; nothing was pushed.\n  recover: git push origin --delete %s (stale branch), then rerun the release\n' \
      "$V" "$RELEASE_BRANCH" "$remote_sha" "$RELEASE_BRANCH" >&2
    exit 1
  fi
}

create_release_branch() {
  step "cut $RELEASE_BRANCH (the only way into dev is a pull request)"
  require_release_branch_is_new
  if ! git switch -c "$RELEASE_BRANCH"; then
    printf 'failed at: cut the release branch.\n  state: the bump commit and tag v%s exist locally; nothing was pushed.\n  recover: git switch -c %s, then rerun the release\n' \
      "$V" "$RELEASE_BRANCH" >&2
    exit 1
  fi
}

push_release_branch() {
  step "push $RELEASE_BRANCH"
  if ! git push -u origin HEAD; then
    printf 'failed at: push the release branch.\n  state: the bump commit and tag v%s exist locally; %s is not on the remote; nothing further happened.\n  recover: git push -u origin %s\n' \
      "$V" "$RELEASE_BRANCH" "$RELEASE_BRANCH" >&2
    exit 1
  fi
}

open_release_pr() {
  step "open the pull request into dev"
  local created url body
  body=$(release_pr_body)
  if ! created=$(gh pr create --base dev --head "$RELEASE_BRANCH" \
    --title "chore: release v$V" --body "$body" 2>&1); then
    printf '%s\n' "$created" >&2
    printf 'failed at: open the pull request.\n  state: %s is pushed; no pull request exists, so dev is unchanged.\n  recover: gh pr create --base dev --head %s --title "chore: release v%s"\n' \
      "$RELEASE_BRANCH" "$RELEASE_BRANCH" "$V" >&2
    exit 1
  fi
  url=$(printf '%s\n' "$created" | grep -o 'https://[^[:space:]]*/pull/[0-9]*' | tail -1)
  if [ -z "$url" ]; then
    printf '%s\n' "$created" >&2
    printf 'failed at: open the pull request.\n  state: %s is pushed but gh printed no PR URL, so no number can be merged.\n  recover: gh pr list --head %s --json number,url\n' \
      "$RELEASE_BRANCH" "$RELEASE_BRANCH" >&2
    exit 1
  fi
  PR_URL="$url"
  PR_NUMBER="${url##*/}"
  printf 'PR #%s %s\n' "$PR_NUMBER" "$PR_URL"
}

# The ruleset requires a pull request but no required status checks, so GitHub will
# merge a release commit whose own workflows are still queued, running or red. This
# is the only thing that stops it: the bump commit's own SHA has to be green before
# `gh pr merge`.
#
# Why 20 minutes and not 5. Measured on `dev`: `Tests` takes ~9 minutes and `Compose
# boot` ~6, and both do run on a pushed release branch (they ran on
# `chore/release-v0.2.3` at 71f31ce). A shorter budget would expire while the slowest
# workflow was still legitimately running, and the gate would start refusing healthy
# releases — the fastest way to teach someone to reach for --skip-ci-check.
BUMP_CI_WAIT_ATTEMPTS=40
BUMP_CI_WAIT_SECONDS=30

# One loop, one verdict per report shape: `none` means GitHub has not created the
# runs yet (normal for a few seconds after a push) and is not a failure; anything
# incomplete is waited on; a completed non-success stops the release at once, because
# no amount of waiting turns red into green; all green returns.
wait_for_green_on_the_bump_commit() {
  local sha attempt report name status conclusion url failed unfinished
  sha=$(git rev-parse HEAD)
  step "wait for CI on the bump commit $sha (branch $RELEASE_BRANCH)"
  if [ "$SKIP_CI_CHECK" -eq 1 ]; then
    warn "--skip-ci-check: the CI gate on the bump commit is NOT enforced for this release"
    print_ci_evidence "$sha" "$RELEASE_BRANCH"
    return 0
  fi
  for attempt in $(seq 1 "$BUMP_CI_WAIT_ATTEMPTS"); do
    report=$(ci_report "$sha" "$RELEASE_BRANCH") || report=""
    if [ -z "$report" ]; then
      warn "could not read CI runs for $sha (attempt $attempt/$BUMP_CI_WAIT_ATTEMPTS); retrying"
    elif [ "$report" = none ]; then
      printf 'no CI run reports on %s yet (branch %s); GitHub creates them seconds after the push, so waiting\n' "$sha" "$RELEASE_BRANCH"
    else
      failed=""
      unfinished=""
      while IFS=$'\t' read -r name status conclusion url; do
        [ -n "${name:-}" ] || continue
        if [ "$status" != completed ]; then
          unfinished+="  $name — $status"$'\n'
        elif [ "$conclusion" != success ]; then
          failed+="  $name — $conclusion — $url"$'\n'
        fi
      done <<<"$report"
      if [ -n "$failed" ]; then
        printf 'failed at: wait for the bump commit CI, before the merge.\n  state: %s is pushed on %s but these workflows are not green; PR #%s is open and unmerged, so dev is unchanged and tag v%s is still local.\n  recover: fix the workflow and push the fix, or rerun with --skip-ci-check deliberately. Not green:\n%s' \
          "$sha" "$RELEASE_BRANCH" "$PR_NUMBER" "$V" "$failed" >&2
        exit 1
      fi
      if [ -z "$unfinished" ]; then
        printf 'CI green on %s: %s\n' "$sha" "$(printf '%s' "$report" | cut -f1 | paste -sd ', ' -)"
        return 0
      fi
      printf 'attempt %s/%s, still running:\n%s' "$attempt" "$BUMP_CI_WAIT_ATTEMPTS" "$unfinished"
    fi
    [ "$attempt" -lt "$BUMP_CI_WAIT_ATTEMPTS" ] || break
    sleep "$BUMP_CI_WAIT_SECONDS"
  done
  printf 'failed at: wait for the bump commit CI, before the merge.\n  state: %s is pushed on %s; after %s attempts over %s minutes nothing turned fully green; PR #%s is open and unmerged, so dev is unchanged and tag v%s is still local.\n  recover: gh run list --branch %s --limit 100 to watch them, then rerun the release (or pass --skip-ci-check deliberately if this is a flake). Unfinished at the last check:\n%s' \
    "$sha" "$RELEASE_BRANCH" "$BUMP_CI_WAIT_ATTEMPTS" "$((BUMP_CI_WAIT_ATTEMPTS * BUMP_CI_WAIT_SECONDS / 60))" \
    "$PR_NUMBER" "$V" "$RELEASE_BRANCH" "${unfinished:-  (no run reports on this SHA)}" >&2
  exit 1
}

# `gh pr merge` can lose a race with GitHub still computing mergeability right
# after the PR opens; one retry covers that, and a second failure is a real block
# the caller has to see with the PR URL in hand.
merge_release_pr() {
  step "merge PR #$PR_NUMBER as a merge commit"
  local out attempt
  for attempt in 1 2; do
    if out=$(gh pr merge "$PR_NUMBER" --merge --subject "chore: release v$V (#$PR_NUMBER)" 2>&1); then
      printf '%s\n' "$out"
      return 0
    fi
    printf '%s\n' "$out" >&2
    if [ "$attempt" -eq 1 ] && printf '%s' "$out" | grep -qEi 'not (yet )?mergeable|not ready|still (being )?(created|checked)|pending'; then
      warn "PR #$PR_NUMBER is not mergeable yet; retrying the merge once"
      sleep 10
      continue
    fi
    break
  done
  printf 'failed at: merge the pull request.\n  state: %s is pushed and PR #%s is open at %s; the merge did not happen, so dev is unchanged and the tag is still local.\n  recover: gh pr merge %s --merge --subject "chore: release v%s (#%s)"\n' \
    "$RELEASE_BRANCH" "$PR_NUMBER" "$PR_URL" "$PR_NUMBER" "$V" "$PR_NUMBER" >&2
  exit 1
}

# Merged is a report; ancestry is a fact. Without this the tag could sit on a
# squashed or never-landed commit and still satisfy every later check.
prove_release_landed_on_dev() {
  step "prove the bump commit landed on dev"
  git fetch origin dev --quiet || {
    printf 'failed at: prove the bump commit landed on dev.\n  state: PR #%s is merged, but origin/dev could not be fetched; the tag is still local.\n  recover: git fetch origin dev && git merge-base --is-ancestor %s origin/dev\n' \
      "$PR_NUMBER" "$(git rev-parse HEAD)" >&2
    exit 1
  }
  if ! git merge-base --is-ancestor HEAD origin/dev; then
    printf 'failed at: prove the bump commit landed on dev.\n  state: PR #%s is merged but %s is not an ancestor of origin/dev, so the tag names a commit dev never had; no tag was pushed.\n  recover: git fetch origin dev && git merge-base --is-ancestor %s origin/dev   (if it still fails the PR was squashed: re-tag on a commit that is on dev)\n' \
      "$PR_NUMBER" "$(git rev-parse HEAD)" "$(git rev-parse HEAD)" >&2
    exit 1
  fi
  printf 'dev contains %s\n' "$(git rev-parse HEAD)"
}

land_bump_commit_through_pr() {
  create_release_branch
  push_release_branch
  open_release_pr
  wait_for_green_on_the_bump_commit
  merge_release_pr
  prove_release_landed_on_dev
}

push_tag() {
  step "push the tag"
  if ! git push origin "v$V"; then
    printf 'failed at: push the tag.\n  state: the release commit is on the remote; tag v%s exists locally but not on the remote.\n  recover: git push origin v%s\n' "$V" "$V" >&2
    exit 1
  fi
}

create_release() {
  step "create the GitHub release"
  if ! gh release create "v$V" --title "$(release_title)" --notes-file "$NOTES"; then
    printf 'failed at: create the GitHub release.\n  state: the commit and tag v%s are on the remote; no release record.\n  recover: gh release create v%s --title "%s" --notes-file %s\n' \
      "$V" "$V" "$(release_title)" "$NOTES" >&2
    exit 1
  fi
}

# The tag, the remote tag and the release record are three separate facts and each
# is checked against its own source — a local tag is not a published release. The
# tag must also be reachable from `dev`: that is what a release means here, and a
# squashed landing is the one way to satisfy every other check and still ship a tag
# nobody can check out.
verify_release() {
  step "verify all three"
  local tag_sha head_sha remote_sha release_json url
  tag_sha=$(git rev-list -n1 "v$V")
  head_sha=$(git rev-parse HEAD)
  [ "$tag_sha" = "$head_sha" ] || refuse "tag v$V points at $tag_sha but HEAD is $head_sha"
  printf 'tag    v%s -> %s (local HEAD)\n' "$V" "$tag_sha"

  git fetch origin dev --quiet || refuse "could not fetch origin dev to prove the tag landed"
  git merge-base --is-ancestor "$head_sha" origin/dev \
    || refuse "tag v$V points at $head_sha, which origin/dev does not contain. A squash-merged release PR leaves the tag unreachable from dev"
  printf 'dev    contains %s (reachable from origin/dev)\n' "$head_sha"

  remote_sha=$(git ls-remote --tags origin "refs/tags/$V" "refs/tags/v$V" | awk '!/\^\{\}/ {print $1}')
  [ "$remote_sha" = "$head_sha" ] || refuse "tag v$V is not on origin at $head_sha (got '${remote_sha:-nothing}')"
  printf 'remote origin has v%s -> %s\n' "$V" "$remote_sha"

  release_json=$(gh release view "v$V" --json tagName,isDraft,publishedAt,url)
  printf '%s\n' "$release_json"
  printf '%s' "$release_json" | grep -q '"isDraft": *false' || refuse "release v$V exists but is a draft"
  printf '%s' "$release_json" | grep -q '"publishedAt": *"' || refuse "release v$V exists but is unpublished"
  url=$(printf '%s' "$release_json" | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p')

  printf '\nreleased:\n  tag      v%s\n  commit   %s\n  release  %s\n' "$V" "$head_sha" "$url"
}

# --- dry run ----------------------------------------------------------------

plan_the_rest() {
  step "dry run — nothing below was executed"
  printf 'would bump package.json "version" to %s and commit it:\n' "$V"
  printf '  git add package.json && git commit -m "chore: release v%s" -- package.json\n' "$V"
  printf 'would tag it (annotated, message = the notes):\n'
  printf '  git tag -a v%s -F %s\n' "$V" "$NOTES"
  printf 'would land the bump commit through a pull request — the ruleset refuses a push to dev:\n'
  printf '  git switch -c %s\n' "$RELEASE_BRANCH"
  printf '  git push -u origin %s\n' "$RELEASE_BRANCH"
  printf '  gh pr create --base dev --head %s --title "chore: release v%s"\n' "$RELEASE_BRANCH" "$V"
  printf '    --body "<version, notes file %s, and that the SHA must stay unchanged>"\n' "$NOTES"
  printf 'would wait for CI on the bump commit itself, before merging anything (the ruleset requires a PR, not checks):\n'
  printf '  gh run list --branch %s --limit 100 — poll up to %s times, %ss apart (~%s minutes)\n' "$RELEASE_BRANCH" "$BUMP_CI_WAIT_ATTEMPTS" "$BUMP_CI_WAIT_SECONDS" "$((BUMP_CI_WAIT_ATTEMPTS * BUMP_CI_WAIT_SECONDS / 60))"
  printf '    every workflow on the bump commit: completed/success, or the script stops before the merge\n'
  printf '  gh pr merge <n> --merge --subject "chore: release v%s (#<n>)"\n' "$V"
  printf '    (a merge commit, never --squash: the annotated tag must stay reachable from dev)\n'
  printf '  git fetch origin dev && git merge-base --is-ancestor HEAD origin/dev\n'
  printf 'would push the tag and create the release:\n'
  printf '  git push origin v%s\n' "$V"
  printf '  gh release create v%s --title "%s" --notes-file %s\n' "$V" "$(release_title)" "$NOTES"
  printf 'to undo the one file this run wrote:\n  git checkout -- package.json\n'
}

# --- main -------------------------------------------------------------------

VERSION_ARG=""
NOTES=""
REF="origin/dev"
TITLE=""
SKIP_CI_CHECK=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h)
      usage
      exit 0
      ;;
    --notes)
      NOTES="${2:?--notes needs a path}"
      shift 2
      ;;
    --ref)
      REF="${2:?--ref needs a ref}"
      shift 2
      ;;
    --title)
      TITLE="${2:?--title needs a value}"
      shift 2
      ;;
    --skip-ci-check)
      SKIP_CI_CHECK=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -*)
      refuse "unknown flag $1. Try: npm run release -- --help"
      ;;
    *)
      [ -z "$VERSION_ARG" ] || refuse "more than one version given ($VERSION_ARG, $1)"
      VERSION_ARG="$1"
      shift
      ;;
  esac
done

V=$(require_version "$VERSION_ARG")
TAG="v$V"
NOTES=${NOTES:-docs/releases/$V.md}

# The branch the bump commit lands on, and the PR that carries it. Both are read
# by the landing step and by verify_release's failure messages.
RELEASE_BRANCH="chore/release-v$V"
PR_NUMBER=""
PR_URL=""

# Which branch the CI runs are listed from. A SHA has no branch, so `dev` stands.
CI_BRANCH=dev
case "$REF" in
  origin/*) CI_BRANCH="${REF#origin/}" ;;
  HEAD | "") CI_BRANCH=dev ;;
  *) git rev-parse --verify --quiet "refs/heads/$REF" >/dev/null && CI_BRANCH="$REF" || CI_BRANCH=dev ;;
esac

HEAD_SHA=$(git rev-parse HEAD)

step "preconditions"
git fetch origin --prune --quiet || refuse "git fetch origin failed; check the remote before releasing"
require_clean_tree
printf 'clean tree\n'
require_head_is_ref
printf 'HEAD is %s\n' "$REF"
require_new_tag
printf '%s is new\n' "$TAG"
require_notes
printf 'notes: %s\n' "$NOTES"
if [ "$SKIP_CI_CHECK" -eq 1 ]; then
  warn "--skip-ci-check: the CI gate is NOT enforced for this release"
  print_ci_evidence "$HEAD_SHA" "$CI_BRANCH"
else
  require_ci_green "$HEAD_SHA" "$CI_BRANCH"
fi

step "bump package.json to $V"
bump_manifest_version

if [ "$DRY_RUN" -eq 1 ]; then
  plan_the_rest
  exit 0
fi

create_bump_commit
create_tag
land_bump_commit_through_pr
push_tag
create_release
verify_release
