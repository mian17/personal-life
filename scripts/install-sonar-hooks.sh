#!/usr/bin/env bash
# Points this checkout's git hooks at the checked-in ones, so `git commit` runs
# the SonarQube gate. Per-checkout: `core.hooksPath` is local config, so every
# worktree and clone runs this once. Skipped by `git commit --no-verify`.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
git -C "$root" config core.hooksPath .pi/kendex/hooks
printf 'core.hooksPath -> .pi/kendex/hooks in %s\n' "$root"
