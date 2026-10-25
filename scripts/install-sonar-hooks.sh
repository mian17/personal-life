#!/usr/bin/env bash
# Points this repository's git hooks at the checked-in ones, so `git commit`
# runs the SonarQube gate. `core.hooksPath` is local config shared by every
# worktree of this repository, and it is set to an ABSOLUTE path inside the main
# checkout: a worktree sitting on a commit that predates the hooks then still
# runs them, instead of resolving the relative path to a directory that is not
# there and letting git skip the hook without a word.
#
# Per-clone: run this once in the main checkout after merging. Skipped by
# `git commit --no-verify`; the SonarQube CI job on `dev` is the backstop.
set -euo pipefail
toplevel="$(git rev-parse --show-toplevel)"
common="$(git rev-parse --path-format=absolute --git-common-dir)"
main="$(cd "$common/.." && pwd)"
hooks="$main/.pi/kendex/hooks"

# A hook directory without the gate script in it is not the gate: git skips a
# missing hook silently, so half a directory would look installed and gate
# nothing. Prefer whichever copy is complete.
complete() {
	local dir="$1"
	[[ -f "$dir/sonar-check.mjs" && -x "$dir/pre-commit" ]]
}
if ! complete "$hooks"; then
	hooks="$toplevel/.pi/kendex/hooks"
fi
if ! complete "$hooks"; then
	printf 'no complete SonarQube gate (%s + %s) in %s or %s; nothing installed\n' \
		sonar-check.mjs pre-commit "$main" "$toplevel" >&2
	exit 1
fi

git -C "$toplevel" config core.hooksPath "$hooks"
printf 'core.hooksPath -> %s\n' "$hooks"
