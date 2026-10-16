# Handoff — `docker compose up -d --build` hangs: root cause + prevention

Repo: `/home/night/WebstormProjects/personal-life`
Written: 2026-10-16. Author session: found root cause; spec **not** written yet. Repo untouched.

---

## 0. TL;DR

`docker compose up -d --build app feedback-service` never finished. Two causes stacked:

1. **Proximate:** the Docker Desktop VM disk was **100% full** (36 MB free). Every `npm ci`
   stalled writing to a full filesystem.
2. **Structural:** `--build` builds **all 7** services (because `app` `depends_on` all of them),
   and each of the 7 Dockerfiles copies a **different subset** of workspace manifests, so the
   `RUN npm ci` layer has a different cache key in every one — BuildKit cannot dedupe, and 7 full
   monorepo installs run concurrently on a **2 vCPU / 4 GB** VM.

Fix = make the dependency block byte-identical across all 7 Dockerfiles. Proven to collapse the
install to one cached layer. Details in §4–§6.

---

## 1. What was asked

- **Q1:** find the root cause of the hang. → Done, verified (§2).
- **Q2:** spec the structural fix. → **Not started.** Design and constraints in §4–§6.
- **Q3:** prevention. → §5.

User explicitly waived the worktree. Deliverable is spec-only.

---

## 2. Root cause evidence

### Proximate — full disk

```
Docker VM:  overlay  47.1G  44.7G used  36.4M avail  100%
Host:       476G   453G used   20G avail    96%
```

Host also thrashing: 17/23 GB RAM used, 8 GB swap **fully** consumed, load ~4.6.
VM resources: `CPUs=2`, `MemTotal=4.1 GB`.

### Structural — 7 un-deduplicatable installs

- `docker buildx history ls` — 7 builds (one per service) `Running` simultaneously, 13m36s+.
- The 7 `COPY … package.json` blocks take **10–12 of the 14** workspaces, in **7 different
  combinations** → 7 distinct layer keys → 7 independent `npm ci` runs.
- Each run: 568 top-level `node_modules` entries, ~48 s CPU-bound cold, ×7, on 2 vCPUs.
- Previous attempt: **30m31s**, 17% cached, canceled inside `RUN npm ci` — same wall.

### Amplifiers

- BuildKit cache: **23.36 GB total, 22.69 GB reclaimable**.
- A second full stack (`prod-open-wearables-*`) running in the same VM — its app was at
  46% CPU, celery worker 12%, beat 7%. Starving the build.

### Bonus defect — every backend image ships the whole frontend dep tree

Runtime stages do `COPY --from=build /repo/node_modules ./node_modules` (wholesale).
Measured inside the live `personal-life-note-service-1`:

```
/app                      700M
/app/node_modules         700M
  @next                   273M   ← frontend only
  next                    156M   ← frontend only
  @img                     46M
  lucide-react             45M
  playwright-core          14M
```

~530 MB of frontend-only packages inside a NestJS API image. Images are 1.24 GB each
(note/tags/todo/meal/feedback/idp); `app` is 465 MB.

### Ruled out

- **Build context.** `.dockerignore` is effective; context ≈ 25–35 MB / ~5400 files. Not a factor.
- **Registry auth/speed.** `~/.npmrc` → `registry.npmmirror.com`, lockfile pins those URLs;
  reachable from host in 0.14 s. (Not verified from inside the VM container — see §7.)

---

## 3. Immediate unblock (do this first)

```bash
docker compose down
docker buildx prune -af            # reclaim ~22 GB of reclaimable cache
docker compose build feedback-service
docker compose build app           # serial, not parallel
docker compose up -d
```

Then: free host disk (96% full), and raise the Docker Desktop VM to **4 CPU / 8 GB**.
Observed during writing: no build running; VM disk had self-recovered to 74% / 11.6 GB free.
No prune was run by the authoring agent.

---

## 4. The fix — one shared dependency layer

**Make the dependency block byte-identical in all 7 Dockerfiles:**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci
```

Identical instructions ⇒ identical layer key ⇒ BuildKit runs `npm ci` **once**, every other
service reuses it. No base image. No compose change. No build ordering.

### Why not a shared base image (`FROM personal-life-deps`)

**This does not work and must not be attempted.** Verified: `depends_on` does **not** order
Compose builds. `docker compose build svc` with `depends_on: [deps]` did not build `deps` first;
`FROM order-test-deps:latest` failed `pull access denied`. Even `docker compose build svc deps`
failed — they build in parallel. A separately-built base image would break
`docker compose up -d --build`. Dedupe must come from identical instructions *inside* each file.

### What stays per-service (legitimately different)

- The source `COPY` lines (`COPY packages/shared ./packages/shared`, etc.).
- The `RUN npm run build -w @life/…` chain.
- `npm prune --omit=dev`.

---

## 5. Prevention (ranked; T1+T2 are the real fixes)

### T0 — Operational guardrails (stop the *class* of hang recurring)

The hang was "silent, no progress, never finishes". Guard against it structurally:

1. **Cap the BuildKit cache.** Unbounded cache growth is what filled the disk.
   Keep it bounded and pruning automatic:
   ```jsonc
   // ~/.docker/daemon.json  (Docker Desktop → Settings → Docker Engine)
   { "builder": { "gc": { "defaultKeepStorage": "10GB", "enabled": true } } }
   ```
   Also `docker builder prune --filter until=168h` on a schedule if desired.
2. **Right-size the VM.** 2 vCPU / 4 GB is undersized for 7 parallel workspace installs.
   Set **4 CPU / 8 GB** in Docker Desktop → Resources.
3. **Never run two stacks' builds at once.** The `prod-open-wearables-*` stack halved the CPU
   available. Build when it is down.
4. **Don't `--build` the world.** `docker compose up -d --build app` still builds every
   dependency service. Build the specific service, then `up -d` without `--build`.
5. **Watch disk as a precondition.** A 30-second preflight (below) turns a 30-minute hang into
   an immediate, named failure.

### T1 — The one-layer fix (§4) — eliminates 7 installs → 1

This is the highest-value change: it removes ~6/7 of the build work permanently and needs no
orchestration change.

### T2 — Stop shipping the frontend dep tree in backend images

`COPY --from=build /repo/node_modules ./node_modules` is why every API image is 1.24 GB.
Options, in increasing effort:

- **Best:** in the build stage, produce a **production-only, service-scoped** `node_modules`
  (`npm ci --omit=dev` for a pruned tree, or `npm prune --omit=dev` from a copy of the shared
  tree) and copy *that* into the runtime. Removes ~530 MB per backend image.
- **Cheap interim:** at minimum exclude the obvious frontend-only packages from runtime copies.
- This is a **separate decision** from T1 and has a bigger blast radius — it changes what the
  running service can resolve at runtime. Gate it behind a boot + smoke test of each service.

Note the interaction: `npm prune --omit=dev` **mutates** `node_modules`, so it cannot live
inside the shared layer without un-deduping it and breaking services that need dev deps to
build. It must run per-service, after the shared layer.

### T3 — Mechanical guard (lesson 0008: enforce at the tool layer, not by instruction)

A preflight script that fails loudly *before* a build starts. Cheap, and it makes this failure
mode unrepeatable:

```bash
#!/usr/bin/env bash
# scripts/preflight-build.sh  — run before `docker compose up -d --build`
set -euo pipefail

# 1. Disk headroom (host and VM)
avail_gb=$(df -BG --output=avail /home | tail -1 | tr -dc '0-9')
[ "$avail_gb" -ge 30 ] || { echo "FAIL: host disk ${avail_gb}G free, need 30G"; exit 1; }

# 2. BuildKit cache bounded
cache=$(docker buildx du --verbose 2>/dev/null | awk '/^Total:/{print $2}')
echo "buildkit cache: ${cache:-unknown}"

# 3. The 7 dependency blocks are identical (the actual invariant)
blocks=$(for f in apps/*/Dockerfile; do
  awk '/^COPY package.json package-lock.json/,/^RUN .*npm ci/' "$f" | sha256sum | cut -d' ' -f1
done | sort -u | wc -l)
[ "$blocks" -eq 1 ] || { echo "FAIL: $blocks distinct deps blocks; dedupe is broken"; exit 1; }

echo "preflight: ok"
```

The third check is the one that matters: it encodes "the shared layer must stay shared" as an
executable assertion, so a future edit that re-diverges the blocks fails immediately instead of
silently costing 30 minutes.

---

## 6. Mechanism facts verified empirically (do not re-derive)

| # | Fact | Status |
|---|---|---|
| 1 | `COPY --parents apps/*/package.json packages/*/package.json ./` works (BuildKit v0.25.2) | ✅ tested |
| 2 | Identical `COPY`+`RUN` in two different Dockerfiles → second build fully `CACHED` | ✅ tested |
| 3 | Unified `npm ci` over all 14 workspaces succeeds — cold 48.8 s, 568 top-level dirs | ✅ tested |
| 4 | `npm ci` succeeds with only 1 of 14 manifests present, and does **not** link the missing workspaces (`require('@life/shared')` → `MODULE_NOT_FOUND`) | ✅ tested |
| 5 | `depends_on` does **not** order Compose builds; a `FROM <other-service-image>` fails `pull access denied` | ✅ tested |
| 6 | `.dockerignore` effective; context ≈ 25–35 MB / ~5400 files | ✅ measured |
| 7 | No workspace has `prepare`/`postinstall`/`preinstall`; no `file:`/`link:`/`workspace:` deps | ✅ checked |
| 8 | Registry reachable from host in 0.14 s | ⚠️ not verified from inside the VM build container (`time` absent in `node:22-bookworm-slim`) |

**Precision note on fact 2:** dedupe was proven for **sequential** builds. BuildKit's solver is
documented to merge identical concurrent vertices too (moby/buildkit#4674; Depot docs), but that
specific concurrency path was not directly measured here. Expect the first build after the change
to do one install and the rest to reuse it; if a concurrent cold build still looks like N
installs, re-measure with `docker buildx history logs`.

Finding **#4** is worth internalizing: it means the current per-service `COPY` subsets never
actually slimmed anything — they only sabotaged the cache. That is the whole bug in one line.

---

## 7. Open questions for the spec author

- Does unified `npm ci` (all 14 manifests) change the installed **external** dep set vs today?
  External deps come from the same root lockfile either way, so likely identical — but confirm
  with a before/after size comparison on one service.
- Where exactly does `npm prune --omit=dev` land once the layer is shared (§5 T2 interaction)?
- Is the T2 runtime-slimming change in scope for the same spec, or a follow-up?
- Keep `apt-get install python3 make g++` — `better-sqlite3` builds native.
- Add `.worktrees` to `.dockerignore` (hygiene; `.worktrees` totals 4.0 GB but its bulk is
  already-excluded `node_modules` — the residual was not fully reconciled).

---

## 8. Repo conventions the spec must follow

- **Path:** `docs/specs/SPEC-<module>.md` (59 existing). Proposed module id: `compose-build`.
- **House structure** (pattern: `docs/specs/SPEC-feedback-infra.md`):
  H1 → `Module id:` / `Traces to:` / `Reference implementations this mirrors:` →
  `## Objective` → `## Locked-decision traceability` (table) → `## Scope` (in/out/not-changed) →
  `## Tech Stack` → design sections → `## Cache Rules` (Contract 2; "N/A + rationale" is an
  accepted form) → `## Project Structure` → `## Code Style` → `## Testing Strategy` →
  `## Frozen surfaces` → `## Boundaries` (Always / Ask first / Never) → `### Hard lines` →
  `## Success Criteria` → `## Open Questions` → `## Decisions taken during Specify`.
- **Governing intent:** `docs/intent/docker-deploy.md` (2026-09-18). ⚠️ **Stale** — still claims a
  two-service stack and "zero migration"; `docs/runbooks/production-deploy.md:124-128` calls it
  misleading and says treat the runbook as authoritative. Per lesson 0012, engage the governing
  doc rather than silently extending past it.
- Root workspace list: `package.json:5-20` (14 workspaces).
- Relevant files: `apps/{app,note-service,tags-service,todo-service,meal-service,feedback-service,idp}/Dockerfile`,
  `compose.yaml`, `.dockerignore`.

---

## 9. Process context (`~/.config/opencode/AGENTS.md`)

- User **waived the worktree** for this task.
- Deliverable is **spec-only**. A spec is not a plan; the §6 Plan Validation Gate applies to the
  plan later derived from it, not to the spec.
- Build/deploy tooling is **non-feature** → plain §7 lifecycle, **no** five-lane gate.
- Lesson 0015 (size the process). Lesson 0021 (ground the spec in real code/measurements — this
  document is that grounding).
- Deployment is a **hard line** (human-run): any runbook/checklist is documented, not executed.

---

## 10. Files touched

**None in the repo.** All POC artifacts deleted (`/tmp/opencode/*` and two throwaway repo-root
Dockerfiles).

```
git status --porcelain
?? docs/reference-repo/     ← pre-existing, not from this session
?? pictures/                ← pre-existing, not from this session
```

---

## 11. Next step

Write `docs/specs/SPEC-compose-build.md` from §4–§8. If you want the operational part fixed
before the spec, run §3 and apply §5 T0 — those need no design work.
