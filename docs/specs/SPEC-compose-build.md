# Spec: compose-build — one shared dependency layer across the seven Dockerfiles

Module id: `compose-build`.
Traces to: `docs/intent/docker-deploy.md` (CONFIRMED 2026-09-18 — **stale**, see "Governing-doc
reconciliation"), `docs/runbooks/production-deploy.md` (authoritative deploy doc).
Reference implementations this mirrors: `docs/specs/SPEC-feedback-infra.md` (infra spec shape),
`docs/lessons/0016-dry-one-owner-per-rule.md` (one owner per rule — here, one owner per cached
layer), `docs/lessons/0021-ground-plans-in-existing-code-before-validation.md` (every number
below is measured, not estimated).
Origin: `docs/research/docker-compose-build-hang.md` (root-cause handoff, 2026-10-16).

## Objective

`docker compose up -d --build` currently builds each of the seven service images with a
**different** `npm ci` layer, so BuildKit cannot dedupe it and runs a full 14-workspace monorepo
install **seven times** instead of once. On a 2 vCPU / 4 GB Docker VM this takes >30 minutes and
appears to hang.

Remove the duplication: make the dependency block **identical in all seven** `apps/*/Dockerfile`
files (comments and blank lines aside — Docker's parser discards those, verified below).
Identical instructions produce an identical layer key, so BuildKit builds `npm ci` once and every
other service reuses the same layer. No base image, no `compose.yaml` change, no build ordering.

Guard the invariant mechanically (`scripts/preflight-build.sh`) so a future edit cannot silently
re-diverge the blocks and reintroduce a 30-minute build.

## Governing-doc reconciliation

`docs/intent/docker-deploy.md:35-45` still describes a two-service stack (web + api) with "zero
migration". That was true for the 2026-09-18 delivery; today the stack is nine application
services behind `compose.yaml`, and `docs/runbooks/production-deploy.md:124-128` already declares
the intent misleading and the runbook authoritative.

Per lesson 0012, this spec **engages** that doc rather than extending past it silently: the
intent is not edited by this change, and the build contract it implies (`docker compose up -d
--build` builds and runs the stack — line 20) is preserved exactly. What changes is only *how
many times* one install runs, which the intent never constrains. A one-line status pointer is
added to the runbook's "Known doc debt" section; the intent itself is left alone.

## Locked-decision traceability

| Intent decision / measured fact | Encoded in |
|---|---|
| Intent "Success": `docker compose up -d --build` builds and runs the stack | `## Success Criteria` 1–2 (the command builds all seven images, unchanged) |
| Intent "Constraints": do not copy `apps/*/data/` or `.env*` into any image | `.dockerignore` unchanged; `**/data`, `**/.env`, `**/.env.*`, `!**/.env.example` stay |
| Handoff fact 1 — `COPY --parents apps/*/package.json packages/*/package.json ./` works | `## The dependency block` (canonical form) |
| Handoff fact 2 — identical `COPY`+`RUN` ⇒ second build fully `CACHED` | `## Success Criteria` 3 (the dedupe proof) |
| Handoff fact 4 — a partial manifest set never slimmed the install | `## Why the per-service COPY lists must go` |
| Handoff fact 5 — `depends_on` does not order Compose builds; `FROM <service-image>` fails | `## Rejected alternative — a shared base image` |
| Handoff §5 T3 — enforce at the tool layer, not by instruction | `scripts/preflight-build.sh` |
| `docs/lessons/0016` — one owner per rule | One canonical dep block; the preflight script is the single assertion of it |

## Scope

- **In scope:** the build stage (from `FROM` through `RUN npm ci`) of all seven
  `apps/*/Dockerfile` files; a new `scripts/preflight-build.sh`; an `.dockerignore` addition;
  a doc pointer in `docs/runbooks/production-deploy.md`.
- **Out of scope:** runtime-stage slimming (see `## Deferred — T2 runtime image size`); the
  service definitions in `compose.yaml` (unchanged — no new service, no new dependency edge);
  `packages/*` sources; any application code.
- **Not changed:** application behavior, ports, env vars, secrets, healthchecks, volumes,
  healthcheck ordering, `depends_on`, the e2e selector surface, token values, PWA constants.

## Tech Stack

No new dependency, no new workspace, no new image. The change is made of existing instructions
in the existing base image:

- `node:22-bookworm-slim` (unchanged).
- BuildKit's `--parents` flag on `COPY`, available since Dockerfile syntax 1.7 and verified
  working on the installed Buildx v0.37.1 / Docker 29.8.1.
- BuildKit's `--mount=type=cache` for the npm download cache, scoped with `sharing=locked` so
  concurrent builds sharing the cache serialise their writes instead of corrupting each other.
- `bash` + `sha256sum` + `awk` for the preflight script — stock, no CI runner required.

## The dependency block

This block, **identical in all seven files** (modulo comments and blank lines, which the parser
discards):

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# --- shared dependency layer (SPEC-compose-build) ------------------------------
# The same instructions in all seven apps/*/Dockerfile files. Do not edit one
# without editing all seven: a different block is a different layer key, which
# un-dedupes `npm ci` and costs ~30 minutes of build. `scripts/preflight-build.sh`
# asserts the seven blocks match.
COPY package.json package-lock.json ./
COPY --parents apps/*/package.json packages/*/package.json ./

RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci
```

Notes on each line:

- **`COPY --parents`** preserves each source's path relative to the context, so
  `apps/app/package.json` lands at `apps/app/package.json` — the layout npm workspaces require.
  It resolves to all 14 manifests from `package.json:5-20`.
- **Blank lines and comments are not part of the layer key.** Verified: two Dockerfiles differing
  only by a blank line between two instructions produce the same cache key and the second build
  reports `CACHED`. The block hash used for the invariant therefore ignores blank and comment
  lines, matching Docker's own parser. The canonical block below is still written one way — with
  a blank line before `RUN` — because the seven files should read the same, not because a missing
  blank line would cost a rebuild.
- **`--mount=type=cache,target=/root/.npm,sharing=locked`** makes the npm download cache a
  BuildKit cache mount instead of image content, so seven parallel builds share one download
  cache and never write to it concurrently. It is inside the shared block, so it matches
  everywhere. `npm ci` still writes `/repo/node_modules` normally; only the registry download
  cache is mounted.
- **`apt-get install python3 make g++` stays.** `better-sqlite3` compiles a native binding at
  install time (used by note, tags, todo, meal, idp and `@life/db`). Removing it breaks every
  SQLite service's build.

## Why the per-service `COPY` lists must go

Measured on the current tree. Each `apps/*/Dockerfile` copies a different subset of the 14
workspace manifests:

| Dockerfile | manifests copied | missing |
|---|---|---|
| `app` | 14 | meal-service, packages/db |
| `meal-service` | 14 | feedback-service, packages/app-kit |
| `note-service` | 13 | meal-service, app-kit, nutrition |
| `tags-service` | 13 | meal-service, app-kit, nutrition |
| `feedback-service` | 12 | meal-service, app-kit, db, nutrition |
| `todo-service` | 12 | meal-service, app-kit, db, nutrition |
| `idp` | 12 | meal-service, app-kit, db, nutrition |

Hashing the build block (every non-comment, non-blank line from `FROM` through `RUN … npm ci`):

```
30be2e38…  apps/feedback-service/Dockerfile
30be2e38…  apps/todo-service/Dockerfile      ← the only accidental pair
42538933…  apps/app/Dockerfile
77fc62d8…  apps/meal-service/Dockerfile
9e202754…  apps/idp/Dockerfile
dcf6a0ec…  apps/note-service/Dockerfile
e2a3b2c8…  apps/tags-service/Dockerfile
```

**Six distinct blocks out of seven files.** Each distinct block is a distinct BuildKit layer
key, so `docker compose up -d --build` runs six independent `npm ci` invocations concurrently.

The lists look like an optimisation — "only copy this service's manifests so npm installs less".
They are not. npm resolves the workspace graph from `package.json`'s `workspaces` array; the
manifest files only supply each workspace's **dependency ranges**. Any manifests that are absent
simply produce a workspace npm cannot link, and `npm ci` still installs the full external
dependency set for everything it *can* see — it just fails to link the missing ones
(`require('@life/shared')` → `MODULE_NOT_FOUND`). The subsets never made any install smaller;
they only changed the cache key. The per-service source `COPY` lines below the block do the real
slimming.

## What stays per-service

Legitimately different, and deliberately **not** touched:

- The source `COPY` lines (`COPY packages/shared ./packages/shared`, …) — each service copies
  only what it builds.
- The `RUN npm run build -w @life/… && npm prune --omit=dev` chain — each service builds its own
  workspace chain.
- The entire runtime stage (`FROM node:22-bookworm-slim AS runtime` onward).

## The preflight script

New file `scripts/preflight-build.sh` (mode `755`), the mechanical guard from handoff §5 T3.
It fails loudly *before* a build starts, turning a 30-minute silent hang into a named error.

```bash
#!/usr/bin/env bash
# Preflight for `docker compose up -d --build` (SPEC-compose-build).
# Fails before starting a build that would take 30 minutes instead of 2.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. Host disk headroom. A full disk makes every npm ci stall with no error.
avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
[ "${avail_gb:-0}" -ge 30 ] || fail "host disk ${avail_gb:-?}G free, need 30G"

# 2. Docker daemon reachable. Without this the rest is meaningless.
docker info >/dev/null 2>&1 || fail "docker daemon not reachable"

# 3. The invariant: the seven dependency blocks must be byte-identical.
#    Block = every non-comment, non-blank line from FROM through RUN ... npm ci.
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
```

The script is non-destructive: it reads files and queries the daemon. It never builds, prunes,
stops, or writes.

- **Invocation.** Documented as the step before a stack build:
  `bash scripts/preflight-build.sh && docker compose up -d --build`. Not wired into
  `compose.yaml` (compose cannot run a host script) and not into a git hook (hooks are
  per-clone and silently absent in CI, so the check would not hold).
- **Why the block hash and not a manifest list.** The failure mode is "the blocks diverged", of
  which "the manifest lists diverged" is one instance and "someone reordered the `FROM`/`WORKDIR`
  lines" is another. Hashing the whole block catches both.
- **Not a fifth check.** This is the only new automated gate in this change; `npm run typecheck`
  and the existing test suites are unchanged.

## Cache Rules (AGENTS.md Contract 2 — N/A, with rationale)

This module owns no application cache and touches no Redis. It changes Docker **build** layers,
which is a different mechanism with different rules.

- **Cached shapes:** BuildKit layer cache entries for the `npm ci` block, plus the
  `/root/.npm` download cache mount. Both hold dependency manifests and registry tarballs —
  public package content, no application data, no ciphertext, no user content.
- **Key composition:** the block's instruction bytes (hence "byte-identical ⇒ one key"). The
  source `COPY` lines below it remain per-service and correctly produce per-service keys.
- **Invalidation:** BuildKit's normal rule — a change to `package.json`, `package-lock.json`, or
  any of the 14 workspace manifests invalidates the layer and re-runs `npm ci` once for the whole
  fleet.
- **Failure mode:** fail-**closed** on dedupe (a divergent block is caught by the preflight
  script), fail-**open** on the download cache (a cold or missing `/root/.npm` mount only costs
  network time; `npm ci` still succeeds). No request path is involved, so Contract 2's
  "the cache may never cause unavailability" is satisfied trivially.
- **Mechanical check:** `bash scripts/preflight-build.sh` exits non-zero iff the blocks diverge
  (Contract 2's "every backend service spec has a `## Cache Rules` section" analogue).

## Deferred — T2 runtime image size

Recorded, specified separately, **not** implemented here.

Every backend runtime stage ends with `COPY --from=build /repo/node_modules ./node_modules`
(`apps/note-service/Dockerfile:46` and the same line in idp, tags, todo, feedback, meal). That
copies the whole pruned workspace tree, so each NestJS API image also ships the frontend
packages. Measured inside a running `note-service` container:

```
/app                      700M
/app/node_modules         700M
  @next                   273M   ← frontend only
  next                    156M   ← frontend only
  @img                     46M   ← frontend only
  lucide-react             45M   ← frontend only
  playwright-core          14M
```

Backend images are 1.24 GB each; `app` is 465 MB. Removing the frontend-only packages is worth
roughly 530 MB per backend image.

**Why it is a separate spec, not this one.** It changes what a running service can resolve at
runtime, so it needs a per-service boot + smoke gate that this change does not. T1 does not:
the shared layer changes *which processes install* the tree, not *what the tree contains* for
the runtime stage, because `npm prune --omit=dev` still runs per-service after the shared layer
and the currently-installed tree already carries `next` (from `app`'s manifest, which is in
every block).

**One measurable delta T1 must confirm.** With all 14 manifests present, `npm ci` links all 14
workspaces, so `npm prune --omit=dev` in each service now prunes a larger input tree. The
expected effect is small — the large frontend packages are already installed by every service
today — but the added workspaces bring additional prod dependencies (`better-sqlite3`, `argon2`,
`oidc-provider`, `@life/db`, `@life/nutrition`) into service trees that did not have them.
`## Success Criteria` 5 measures it rather than assuming.

**Interaction noted for the T2 spec:** `npm prune --omit=dev` mutates `node_modules`, so it
cannot move into the shared layer. It must stay per-service, after the block.

## Operational preconditions (human-run — documented, not executed)

These are Docker Desktop / host settings, not repository content. They are the difference
between a fast build and a hang even with dedupe in place. Recorded here so the T0 checklist
has one owner; a pointer is added to `docs/runbooks/production-deploy.md`.

The 2026-10-16 hang had a second, environmental cause: the Docker VM disk was 100 % full
(36 MB free of 47.1 GB) behind an unbounded 23.36 GB BuildKit cache, and a second full stack
(`prod-open-wearables-*`) was consuming CPU in the same VM. Dedupe alone does not protect
against that.

- [ ] **Bound the BuildKit cache.** Docker Desktop → Settings → Docker Engine:
      `{ "builder": { "gc": { "defaultKeepStorage": "10GB", "enabled": true } } }`.
- [ ] **Right-size the VM.** 4 CPU / 8 GB (2 vCPU / 4 GB is undersized for a monorepo install).
- [ ] **Do not build two stacks at once.** Build when no other stack is running.
- [ ] **Build the service, then start.** `docker compose build <svc>` then `docker compose up -d`
      — `up -d --build` builds every service reachable through `depends_on`, which for `app` is
      the whole stack.

## Project Structure

```
apps/{app,note-service,tags-service,todo-service,meal-service,feedback-service,idp}/Dockerfile
    # build stage: the per-service manifest COPY lists collapse into the canonical block
scripts/preflight-build.sh     # new: the dedupe assertion
.dockerignore                  # + .worktrees
docs/runbooks/production-deploy.md
    # "Known doc debt" gains a pointer to this spec; a preflight step is added to the deploy
```

Supporting edits (same change):

- `.dockerignore`: add `.worktrees` (hygiene). `.worktrees/` measures 4.0 GB; its bulk is
  already-excluded `node_modules`, so the win is small — it stops the residual from entering
  every build context. `.gitignore` already ignores `.worktrees/`; `.dockerignore` does not
  list it, so it is copied today. It is not `**`-globbed, unlike the entries above it.
- `docs/runbooks/production-deploy.md`: one line in "Known doc debt" pointing at this spec, and
  the preflight command added to the deploy steps.

## Code Style

Dockerfiles are prose: one canonical block, quoted verbatim in all seven files with the same
comment header naming this spec, so a reader who opens any one of them finds the rule. The
per-service `COPY` lines below the block keep their existing comment headers (they are still
per-service and still correct).

The preflight script follows the repo's bash conventions: `set -euo pipefail`, a single `fail()`
helper, `cd` to the repo root from the script's own location, output on stderr for failures and
stdout for the success line, no flags, no arguments. It reads and queries only.

## Testing Strategy

This change is build tooling with no application logic, so the verification is command-level,
not unit tests. **The layer-key, preflight, and dedupe checks below were run while writing this
spec**, on the current (un-deduped) tree: the guard reported the six distinct blocks and exited 1,
a three-file fixture with identical blocks reported `preflight: ok` and exited 0, and the fixture
below printed `CACHED` for identical blocks and `DONE` for divergent ones. The full-stack build
checks are for implementation.

Per the Project Profile, run from the repository root:

```bash
bash scripts/preflight-build.sh                 # must print "preflight: ok"
docker compose build --no-cache idp             # the shared layer builds from cold
docker compose build idp                        # ...and is fully CACHED the second time
docker compose up -d --build                   # the whole stack builds
docker compose ps                              # every healthcheck green
```

Cover:

- **The 5-second fixture (do this first).** The dedupe mechanism is provable without touching the
  repo or waiting on a seven-service build: two throwaway Dockerfiles differing only *below* the
  dependency block, then read the second one's verdict.
  ```bash
  mkdir -p /tmp/dtest/apps/{svc-a,svc-b} /tmp/dtest/packages/ui && cd /tmp/dtest
  echo '{"name":"root","workspaces":["apps/*","packages/*"]}' > package.json
  echo '{}' > package-lock.json
  for p in apps/svc-a apps/svc-b packages/ui; do echo "{\"name\":\"$p\"}" > $p/package.json; done
  for s in svc-a svc-b; do printf '%s\n' \
    '# syntax=docker/dockerfile:1' \
    'FROM node:22-bookworm-slim AS build' \
    'WORKDIR /repo' \
    'COPY package.json package-lock.json ./' \
    'COPY --parents apps/*/package.json packages/*/package.json ./' \
    'RUN --mount=type=cache,target=/root/.npm,sharing=locked echo NPM-CI-RAN' \
    '' \
    "COPY apps/$s ./apps/$s" > apps/$s/Dockerfile; done
  docker builder prune -af
  docker build -q -f apps/svc-a/Dockerfile . >/dev/null
  docker build --progress=plain -f apps/svc-b/Dockerfile . 2>&1 | grep -A1 'build 5/'
  ```
  `CACHED` on that last line means dedupe works; `DONE` means the layer re-ran. To see the bug,
  replace `svc-b`'s `COPY --parents` with `COPY apps/svc-b/package.json apps/svc-b/` — it flips to
  `DONE`. Clean up with `rm -rf /tmp/dtest`.
- **The invariant holds.** `preflight-build.sh` exits 0 on the committed tree.
- **The guard actually fires.** Temporarily delete one `COPY --parents` line from a single
  Dockerfile; the script must exit 1 and name that file. Restore it. (A guard that has never
  failed is not known to work.)
- **Cold build then warm build.** `docker compose build --no-cache idp` then
  `docker compose build idp` shows `CACHED` for the `COPY --parents` and `RUN npm ci` steps,
  proving the layer is reusable.
- **Dedupe across services.** `docker compose build note-service meal-service` (no `--no-cache` —
  the flag defeats this test): the second service reuses the first's `npm ci` layer. Confirm in
  `docker buildx history logs` that `npm ci` ran once, not twice.
- **No regression in the images.** Every service boots and its healthcheck goes green.
- **`docker compose config` is unchanged** apart from nothing — this change does not touch
  `compose.yaml` at all, so the diff must be empty.

## Frozen surfaces (human-owned — this change touches none)

- The e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`).
- Token values (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md` value table).
- PWA constants (`public/manifest-*.json`, `viewport.themeColor`).

This change edits Dockerfiles' build stage, adds one shell script, and adds one `.dockerignore`
line. No UI code, no selectors, no tokens, no PWA constants.

## Boundaries

- **Always:** keep the dependency block identical across all seven Dockerfiles (comments and
  blank lines excepted — the layer key is what must match); keep `python3 make g++` in the block;
  run `scripts/preflight-build.sh` before a stack build; keep the preflight script read-only;
  keep the per-service source `COPY` lines and the `RUN npm run build -w …` chain per-service.
- **Ask first:** moving any part of the dependency block out of the Dockerfiles (a base image,
  a compose profile, a builder stage); adding a service to `compose.yaml`; changing the
  preflight thresholds (30 GB disk); wiring the preflight into a git hook or CI; bundling the
  T2 runtime slimming into the same change.
- **Never:** let the blocks diverge (the preflight script exists to make this impossible); build
  a base image that other services' `FROM` lines depend on; `docker compose up -d --build` while
  a second stack is running; prune the BuildKit cache mid-build; touch `compose.yaml`'s service
  definitions as part of this change; change the e2e selector surface, token values, or PWA
  constants.

### Hard lines (human-run — documented, not executed by the agent)

Production deploy remains a hard line. This spec documents it; the human runs it. The build
change alters what lands in the images, so the deploy checklist is:

- [ ] `bash scripts/preflight-build.sh` → `preflight: ok`.
- [ ] Free host disk (≥ 30 GB) and bound the BuildKit cache (see
      `## Operational preconditions`).
- [ ] Confirm no other stack is running: `docker compose ls`.
- [ ] `docker compose build <service>` for each service, **serially**, then `docker compose up -d`
      without `--build`. (`up -d --build` also works once the cache is warm.)
- [ ] `docker compose ps` — every healthcheck green.
- [ ] Smoke: app on `127.0.0.1:3002`, idp on `127.0.0.1:3003`, and one write through each API.
- [ ] Rollback: `git revert` the Dockerfile change and rebuild — the previous images are a
      build away, and no data or schema is touched.

## Success Criteria

1. All seven `apps/*/Dockerfile` build blocks produce one layer key:
   `for f in apps/*/Dockerfile; do awk '/^FROM /{p=1} p && !/^#/ && NF {print} /^RUN .*npm ci/{if(p) exit}' "$f" | sha256sum; done | sort -u | wc -l`
   prints `1`.
2. `bash scripts/preflight-build.sh` prints `preflight: ok — 1 dependency block across 7
   Dockerfiles` and exits 0; deleting any one `COPY --parents` line makes it exit 1 and name the
   offending file.
3. **Dedupe proof:** after a cold build, `docker compose build note-service meal-service`
   runs `npm ci` **once** (visible in `docker buildx history logs`) and reports the second
   service's `COPY --parents` and `npm ci` steps as `CACHED`. Dedupe across **sequential** builds
   is proven here (handoff §6 fact 2). Concurrent dedupe — seven services in one `up -d --build`
   merging onto one vertex — is documented BuildKit behavior (`moby/buildkit#4674`) but was not
   directly measured; if the first cold build after this change still shows six installs,
   re-measure with `docker buildx history logs` before concluding the fix failed.
4. `docker compose up -d --build` completes, `docker compose ps` shows every service healthy,
   and the app is reachable on `127.0.0.1:3002`.
5. **No image regression:** each runtime image's size is within 10 % of its pre-change size, and
   the delta is explained by the added workspace prod dependencies. `docker run --rm
   --entrypoint node <image> -e "require('@life/shared')"` succeeds in every backend image.
6. `git diff --stat` touches only the seven Dockerfiles, `scripts/preflight-build.sh`,
   `.dockerignore`, and `docs/runbooks/production-deploy.md` — `compose.yaml` is untouched.
7. `.worktrees` no longer appears in the build context:
   `docker build --no-cache -f apps/idp/Dockerfile --target build . 2>&1 | grep -c worktrees`
   prints `0` (or the context-size check in `docker buildx history inspect` shows no growth
   from it).
8. Every existing workspace's `npm run typecheck` and `npm run test:unit` still pass — this
   change touches no TypeScript, so a failure means something else moved.

## Open Questions

None blocking. Four items for the plan:

1. **Image-size delta (Success 5).** The exact delta depends on what `npm prune --omit=dev`
   removes from a 14-workspace tree; measure per service during implementation and record it.
   If a backend image grows more than 10 %, the T2 spec moves up in priority.
2. **`--parents` on the pinned syntax version.** `# syntax=docker/dockerfile:1` resolves to the
   latest 1.x at build time. The flag needs ≥ 1.7. The installed Buildx v0.37.1 satisfies this and
   fact 1 was verified on it; if a future environment pins an older builder, pin
   `# syntax=docker/dockerfile:1.7` in the same block across all seven.
3. **`.worktrees` residual.** `.worktrees` totals 4.0 GB but most of it is already-excluded
   `node_modules`; the residual (source + `dist`) was not fully reconciled. Adding the
   `.dockerignore` entry is correct either way; the size win is unquantified.
4. **The disk threshold in the preflight script.** 30 GB is a starting number, not a measurement:
   the script's own claim is only that a full disk makes `npm ci` stall. Tune it after the first
   real build shows how much headroom an image build actually consumes.

## Decisions taken during Specify

1. **No shared base image.** A `FROM personal-life-deps AS build` image would need building
   before anything else, and Compose does not order builds. Verified: `depends_on` does not
   order `docker compose build`; `docker compose build svc deps` builds them in parallel; a
   `FROM <other-service-image>` fails with `pull access denied`. A base image would break
   `docker compose up -d --build` outright. Dedupe must come from identical instructions *inside*
   each file — which is the one mechanism BuildKit dedupes for free.
2. **All 14 manifests, not a curated subset.** Any subset is a different cache key per service
   by construction, which is the bug. The shared block uses the full workspace glob.
3. **The npm cache is a `--mount=type=cache`, not image content.** It keeps ~568 packages of
   tarballs out of every layer, and `sharing=locked` keeps seven parallel builds from writing it
   concurrently. The mount is inside the shared block, so it is identical across the seven.
4. **`python3 make g++` stays in the shared block.** `better-sqlite3` is a prod dependency of five
   services and `@life/db`; a native compile is required. Moving it out would put a divergent
   instruction inside the block.
5. **The preflight is a script in `scripts/`, not a git hook or CI job.** Hooks are per-clone and
   absent in CI; there is no CI config in this repo. A script that the runbook names is the
   enforcement point, and it fails before 30 minutes are wasted.
6. **T2 (runtime slimming) is a separate spec.** It changes runtime resolvability and needs a
   per-service boot gate. Bundling it would put an unverified image-surface change behind a
   build-speed change.
7. **`.dockerignore` gains `.worktrees` but not other entries.** It is the only untracked
   4 GB-scale directory in the repo root; the rest of the file is already correct.
