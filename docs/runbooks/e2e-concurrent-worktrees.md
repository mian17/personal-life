# Runbook: two e2e harnesses at once

The slot queue isolates **ports and containers**. It cannot isolate a directory, so
two stacks in one worktree are impossible — every service builds with
`deleteOutDir` and the app has a single `.next`. The queue therefore refuses a
second attempt in a worktree that already holds a slot (`E2E_WORKTREE_BUSY`,
exit 75) instead of handing it slot 1.

Concurrency means **two worktrees**, each with its own `node_modules` and its own
build output.

## Prepare a second worktree

Only the first time, and after any change to the harness:

```bash
cd /home/night/WebstormProjects/personal-life
git worktree add -b pi/wf/slot-owned-infra-2 \
  .pi/worktrees/slot-owned-infra-2 pi/wf/slot-owned-infra

# node_modules is gitignored, so the new worktree has none. Copy, do not install:
# `npm ci` here has wiped node_modules on this machine before.
cp -a .pi/worktrees/slot-owned-infra/node_modules \
      .pi/worktrees/slot-owned-infra-2/node_modules

# The packages the app imports at build time are gitignored too.
cd .pi/worktrees/slot-owned-infra-2
npm run build -w packages/shared -w packages/crypto -w packages/cache \
              -w packages/nutrition -w packages/db -w packages/ops
```

`packages/ui` and `packages/app-kit` ship TypeScript sources (`exports` points at
`./src/index.ts`) and need no build.

Verify: `cd apps/app && npx tsc --noEmit`.

## Run two harnesses at once

```bash
cd /home/night/WebstormProjects/personal-life/.pi/worktrees
for w in slot-owned-infra slot-owned-infra-2; do
  ( cd "$w" && E2E_CONCURRENCY=2 npx playwright test \
      --config apps/app/playwright.config.ts \
      apps/app/test/e2e/feedback.spec.ts > /tmp/e2e-$w.log 2>&1 ) &
done
wait
grep -hE "passed|failed" /tmp/e2e-*.log
```

Pass: two `2 passed` lines, and after both finish
`docker ps -a --filter name=e2e-` is empty.

While they run, `/tmp/life-e2e-slots` holds two claims with disjoint ports:

```
0.hold.json pid 138412 worktree=slot-owned-infra    appPort 3100
1.hold.json pid 138420 worktree=slot-owned-infra-2  appPort 3110
```

## What each worktree must own privately

| Thing | Why |
|---|---|
| `node_modules/` | gitignored; a shared copy resolves `@life/*` to one tree |
| `apps/*/dist`, `apps/app/.next` | `deleteOutDir` deletes what the other run executes |
| `service-pids-*.json` | namespaced by worktree basename, or one teardown SIGTERMs the other run's app (exit 143) |
| `service-slot.json` | same |
| slot claim, ports, containers | per slot, through the queue |

## Failure signatures

| Symptom | Cause |
|---|---|
| `E2E_WORKTREE_BUSY` + exit 75 | second attempt in the same worktree — use the other worktree |
| `ERR_CONNECTION_REFUSED` on your own app port, `[app] exited with code 143` | another worktree's teardown killed you: shared PID file |
| `Module not found: Can't resolve '@life/shared'` | packages not built in this worktree |
| `Another next build process is already running` | two builds in one worktree |
| `/jwks` 500 during setup | a concurrent build deleted a service's `dist` |
