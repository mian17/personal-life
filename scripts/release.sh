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
# its message → push the commit → push the tag → create the GitHub release → verify.
#
# The notes file must already be COMMITTED: precondition 1 is a genuinely empty
# `git status --porcelain`, and an uncommitted notes file is a dirty tree.
#
# Usage: npm run release -- <version> [flags]        (e.g. npm run release -- 0.2.2)
# Run it on `dev` — `git push origin HEAD` pushes the branch HEAD is on.
#
# Flags:
#   --notes <path>     notes file to use instead of docs/releases/<version>.md
#   --ref <ref>        tag this ref instead of origin/dev (must still be clean)
#   --title <title>    release title instead of "v<version> — <first heading>"
#   --skip-ci-check    downgrade precondition 5 to a printed warning and continue.
#                      Use deliberately: a release after a flake must stay possible.
#   --dry-run          check the preconditions, then print every remaining command.
#                      No commit, no tag, no push, no release. The ONE thing it does
#                      write is the package.json version line, so the one-line diff
#                      is inspectable; it prints the revert command.
#   --help             this page. It is the one someone reads at 11pm.
#
# Recovery, by half-state (the script prints the matching line when a step fails):
#   commit missing    → git commit -m "chore: release v<x>" -- package.json
#   tag not created   → git tag -a v<x> -F <notes>
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
ci_report() {
  gh run list --branch "$CI_BRANCH" --limit 100 \
    --json headSha,workflowName,status,conclusion,url \
    --jq "[.[] | select(.headSha == \"$1\")] | if length == 0 then \"none\" else (.[] | \"\(.workflowName)\t\(.status)\t\(.conclusion)\t\(.url)\") end"
}

require_ci_green() {
  local sha="$1" report name status conclusion url failed=""
  report=$(ci_report "$sha") || refuse "could not read CI runs from GitHub (gh run list failed). Check gh auth, or use --skip-ci-check deliberately"
  if [ "$report" = none ]; then
    refuse "no CI run reports on $sha (branch $CI_BRANCH). Push the commit and wait for CI, or pass --skip-ci-check deliberately"
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
  local report
  report=$(ci_report "$1") || report="(gh run list failed)"
  printf 'CI evidence for %s (branch %s), NOT enforced:\n' "$1" "$CI_BRANCH"
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

push_commit() {
  step "push the release commit"
  if ! git push origin HEAD; then
    printf 'failed at: push the release commit.\n  state: the commit and tag v%s exist locally; nothing is on the remote.\n  recover: git push origin HEAD\n' "$V" >&2
    exit 1
  fi
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
# is checked against its own source — a local tag is not a published release.
verify_release() {
  step "verify all three"
  local tag_sha head_sha remote_sha release_json url
  tag_sha=$(git rev-list -n1 "v$V")
  head_sha=$(git rev-parse HEAD)
  [ "$tag_sha" = "$head_sha" ] || refuse "tag v$V points at $tag_sha but HEAD is $head_sha"
  printf 'tag    v%s -> %s (local HEAD)\n' "$V" "$tag_sha"

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
  printf 'would tag and push:\n'
  printf '  git tag -a v%s -F %s\n  git push origin HEAD\n  git push origin v%s\n' "$V" "$NOTES" "$V"
  printf 'would create the release:\n'
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
  print_ci_evidence "$HEAD_SHA"
else
  require_ci_green "$HEAD_SHA"
fi

step "bump package.json to $V"
bump_manifest_version

if [ "$DRY_RUN" -eq 1 ]; then
  plan_the_rest
  exit 0
fi

create_bump_commit
create_tag
push_commit
push_tag
create_release
verify_release
