#!/usr/bin/env bash
# Clears the scratch data this session's test runs left in the worktree, so a
# manual run starts as a genuine first use.
#
# Nothing is deleted: every file is renamed aside, so any of it can be restored
# by renaming it back. Run it from anywhere; it finds the worktree by itself.
#
#   bash scripts/reset-manual-test-data.sh
#
# Stop the stack first (Ctrl-C). A running service holds these files open.
set -u

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

backup() { # path
  local p="$1"
  [ -e "$p" ] || return 0
  mv "$p" "$p.bak-$STAMP" && echo "  moved aside: ${p#"$WT"/}"
}

echo "worktree: $WT"
echo
echo "=== meal-service (the calorie-target proof data) ==="
for f in "$WT/apps/meal-service/data/scratch.db" \
         "$WT/apps/meal-service/data/scratch.db-wal" \
         "$WT/apps/meal-service/data/scratch.db-shm"; do backup "$f"; done

echo "=== todo-service (the meal tasks and completions) ==="
for f in "$WT/apps/todo-service/data/scratch.db" \
         "$WT/apps/todo-service/data/scratch.db-wal" \
         "$WT/apps/todo-service/data/scratch.db-shm"; do backup "$f"; done

echo "=== note-service / tags-service (notes probe rows, incl. trash) ==="
for f in "$WT/apps/note-service/data/scratch.db" "$WT/apps/tags-service/data/scratch.db"; do backup "$f"; done

echo "=== focus-service ==="
backup "$WT/apps/focus-service/data/focus.db"

echo "=== stray root-level data dir (a boot with cwd=repo root) ==="
backup "$WT/data"

echo
echo "left in place on purpose:"
echo "  apps/idp/data/keys.json  — signing keys; deleting them invalidates every session"
echo "                             but does not affect this feature"
echo
echo "=== what remains in the data dirs ==="
for d in todo-service meal-service focus-service note-service tags-service idp; do
  printf '  %-16s ' "$d"
  ls -1 "$WT/apps/$d/data" 2>/dev/null | tr '\n' ' '
  echo
done
echo
echo "Now: npm run dev:build"
