#!/usr/bin/env bash
# The carrier spawns `hooks/<name>.sh` directly, so the guard lives beside its
# logic rather than in a `bash -c` string the registry would have to quote.
# `exec` keeps the exit status the gate's own: 2 refuses, 0 allows.
exec node "$(dirname "${BASH_SOURCE[0]}")/sonar-check.mjs"
