#!/usr/bin/env bash
# Preflight for `docker compose up -d --build` (SPEC-compose-build).
# Fails before starting a build that would take 30 minutes instead of 2.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. Host disk headroom. A full disk makes every npm ci stall with no error.
#    Override to exercise the checks below on a small sandbox:
#    PREFLIGHT_MIN_DISK_GB=1 bash scripts/preflight-build.sh
min_disk_gb=${PREFLIGHT_MIN_DISK_GB:-30}
avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
[ "${avail_gb:-0}" -ge "$min_disk_gb" ] || fail "host disk ${avail_gb:-?}G free, need ${min_disk_gb}G"

# 2. Docker daemon reachable. Without this the rest is meaningless.
docker info >/dev/null 2>&1 || fail "docker daemon not reachable"

# 3. The invariant: the seven dependency blocks must produce one layer key.
#    Block = every non-comment, non-blank line from FROM through RUN ... npm ci
#    (blank/comment lines are not part of Docker's layer key).
block_of() {
  awk '/^FROM /{p=1} p && !/^#/ && NF {print} /^RUN .*npm ci/{if(p) exit}' "$1"
}
mapfile -t files < <(ls apps/*/Dockerfile)
distinct=$(for f in "${files[@]}"; do block_of "$f" | sha256sum; done | sort -u | wc -l)
[ "$distinct" -eq 1 ] || {
  for f in "${files[@]}"; do echo "  $(block_of "$f" | sha256sum | cut -c1-8)  $f"; done >&2
  fail "$distinct distinct dependency blocks; the shared layer is un-deduped"
}
echo "preflight: ok — 1 dependency block across ${#files[@]} Dockerfiles"
