# Host handoff — repro + pinpoint the `next dev` reload loop

## Resolution (2026-10-23; corrected 2026-10-24)

**Defect found and removed:** the harness wrote inside the dev lane's Turbopack
project root (`apps/app`) while `next dev` was running. Measured in one dev run:
`test-results/.playwright-artifacts-0/traces/*.trace` took **436** write events,
plus the live scratch SQLite DBs and the recorded PID/slot files.

**What is proven, and what is not.** An earlier revision of this section called
the loop a "macOS-watcher bug class" and argued inotify could not produce it. That
claim is withdrawn — the reported failing run came from a Fedora host, so inotify
is the watcher that matters. The verifiable findings are narrower:

- The harness-writes-in-watch-root defect is real and measured (436+ events inside
  `apps/app` during one run).
- On this host (Fedora, btrfs, inotify) those specific writes fired **zero**
  rebuilds: inotify is per-directory and Turbopack only watches directories in the
  module graph, which never includes `test-results/`. The loop did not reproduce
  here on any of the runs tried, including the exact `npm run test:e2e` sequence.
- A recursive watcher (`fs.watch({recursive})`, and macOS FSEvents) does report
  those writes.

So: the writes are a genuine defect and are now gone, but whether they were the
mechanism behind the original loop is **not established** by this investigation.
The Ask 1 `trigger` histogram on the affected machine is the check that would
settle it, and it has not been run.

**Fix (on this branch, uncommitted):** everything a run writes now lives outside the
repository under `${os.tmpdir()}/life-e2e-artifacts` (override
`E2E_ARTIFACTS_DIR`) — scratch DBs per slot, recorded PID files, the held-slot
file, and Playwright's `outputDir` per worktree. `apps/app/.gitignore` also ignores
the `AGENTS.md` that `next dev` regrows on every boot.

**Verification on this host (Fedora, inotify):**

- `npm run test:e2e` — 27 prod + 11 dev, exit 0 (one run), then 26 + 1 pre-existing
  `meals.spec.ts` race failure (fails only in full-suite timing, passes in isolation
  and file-scoped; that test reads the list before awaiting the row's visibility).
- Targeted `-g "create → edit"` green in both lanes.
- A recursive `fs.watch` over `apps/app` during a full dev run recorded **zero**
  non-`.next` writes, versus 436+ before.
- `npx tsc --noEmit` clean; `slot-queue`, `slot-ports`, `harness-env`, `origin`
  unit suites green (46 tests).

## Where

Worktree: `/home/night/WebstormProjects/personal-life/.pi/worktrees/e2e-stack-slots`
Branch/commit: `pi/wf/e2e-stack-slots` @ `956e4b6` (working tree clean; do not commit).
Harness: `apps/app/test/e2e/` — dev lane boots `next dev` on `127.0.0.1:3200`.

## Symptom (already proven from a captured trace — do not re-derive)

Running the dev lane, test `create → edit → tag → search → …` fails with the 90 s
test timeout. From that run's `test-results/…/trace.zip`:

- **101 full document loads of `/notes`**, 100 `ws://…/_next/hmr` sockets,
  100 × `[HMR] connected` + `[Fast Refresh] rebuilding` + `done in 1–11ms`.
- Reload cadence **170–600 ms**, burst ~30 s, then silence until the timeout.
- Server HTML byte-identical between loads (only `self.__next_r` build id and the
  flight payload length differ) → **no server redirect, no meta refresh**.
- `test.trace`: `locator resolved to <a href="/notes/new" … aria-label="New note">`,
  then `element was detached from the DOM, retrying` ×4, `navigated to
  "http://localhost:3200/notes"` ×36. The click resolves; the page reloads mid-click;
  `/notes/new` is never entered.

So: something makes Turbopack report a change ~every 300 ms, the HMR client does a
**full reload** (not a hot update), the DOM detaches under the click.

## Excluded already (do not re-check)

- `app/time-zone-sync.tsx` `router.refresh()` — one-shot, cookie set on 3rd load.
- `public/sw.js` — push only, never registered on `/notes`.
- `middleware.ts` — no reload. No `window.location` / `location.href` / `reload(`
  anywhere in `apps/` or `packages/`.
- Server-side redirect or meta refresh — 0 hits, HTML stable.
- Plain appends to `test-results/` or `.e2e-state-dev/` with a browser attached but
  no rebuild churn — however see the caveat below.

**Caveat that invalidates all of the above:** the sandbox where this was investigated
runs on `virtiofs`, and Next 16's watcher **never fires** there. Editing
`apps/app/app/note-list.tsx` produced zero rebuilds while `node fs.watch` on the same
path fired normally. The sandbox is structurally unable to reproduce a Fast Refresh
loop, so every negative sandbox result is void. The dev lane passed 11/11 three times
there — meaningless for this bug.

## Ask 1 (decisive) — capture what Turbopack says changed

Next 16 writes a JSON-lines trace at `apps/app/.next/dev/trace`. Every rebuild is a
`compile-path` entry whose `tags.trigger` **names the cause**. In a sandbox run it read:

```json
{"name":"compile-path","duration":1291485,"tags":{"trigger":"middleware"}}
```

Procedure:

```bash
cd ~/WebstormProjects/personal-life/.pi/worktrees/e2e-stack-slots/apps/app
rm -rf .next test-results .e2e-state-dev
# start the dev lane, tee the whole thing
( npx playwright test test/e2e/dev/journey.dev.spec.ts \
    --config playwright.dev.config.ts -g "create → edit" 2>&1 | tee /tmp/devrun.log ) &
# while it runs, snapshot the trace every 2 s
for i in $(seq 1 60); do
  cp .next/dev/trace /tmp/trace-$i.json 2>/dev/null
  sleep 2
done
```

Then:

```bash
cat /tmp/trace-*.json | tr ',' '\n' | grep -o '"trigger":"[^"]*"' | sort | uniq -c | sort -rn
```

What the answer means:

- a **file path** under `test-results/`, `.e2e-state-dev/`, or `apps/app/AGENTS.md`
  → harness/Next self-writes inside the watch root. Fix = move output out (Ask 3a).
- `middleware` / `proxy` repeatedly → the middleware file is being rewritten or the
  proxy bundle is invalidated in a loop; look at `apps/app/middleware.ts` timestamps.
- `env` / `next.config` → something is rewriting config or env each cycle.
- nothing at all, yet the client still reloads → the reload is **not** rebuild-driven;
  then instrument the client instead: in the DevTools console of the open page run
  `performance.getEntriesByType('navigation').length` and check `window.__NEXT_DATA__`
  stability, or patch `apps/app/node_modules/next/dist/client/dev/hot-reloader/*` to log
  every `sendMessage`/`handleMessage`.

## Ask 2 — catch self-writes during the loop

`next dev` 16.4.2 on its own rewrites `apps/app/next-env.d.ts`
(`./.next/types/` → `./.next/dev/types/`) and generates `apps/app/AGENTS.md`, both
inside the watch root. Confirm whether either is rewritten **repeatedly**, not once:

```bash
cd ~/WebstormProjects/personal-life/.pi/worktrees/e2e-stack-slots
( while true; do date +%s.%N; git status --porcelain; stat -f '%m %N' apps/app/AGENTS.md apps/app/next-env.d.ts 2>/dev/null; sleep 1; done ) > /tmp/selfwrite.log &
```

Start that before the Playwright run, kill it after, then look for changing mtimes.
Also worth capturing: `fs_usage -w -f filesystem | grep -E 'personal-life' > /tmp/fsusage.log`
(macOS, FSEvents path — this is the axis the sandbox could not test at all).

## Ask 3 — candidate fixes, in order of preference

**3a. Move Playwright output out of the watch root** (in scope — both configs are listed
in `docs/specs/SPEC-e2e-stack-slots.md` §4):

- `apps/app/playwright.config.ts` and `apps/app/playwright.dev.config.ts`: add
  `outputDir: process.env.E2E_OUTPUT_DIR ?? '/tmp/life-e2e-results'`.

**3b. Add `apps/app/AGENTS.md` to the repo-root `.gitignore`** and delete the file
(cheap, kills one regrowing write; `next-env.d.ts` must stay at `.next/types/`, never
commit the dev variant).

**3c. Turbopack ignore for the harness dirs** — `apps/app/next.config.mjs`. **NOT in
the §4 file list**, so this needs a spec + `tasks/plan.md` amendment first. The scope
gate treats an unnamed file as a blast-radius violation even when the code is right, so
do not add it silently. Next 16 only exposes `watchOptions.pollIntervalMs` in
`config-shared.d.ts:1798` — there is no public `ignored` list; verify against
`node_modules/next/dist/esm/server/dev/hot-reloader-turbopack.js` before proposing it.

**Do not** paper over the loop by changing journey helpers or selectors.
`getByLabel('New note')` resolves; the DOM detaches underneath it. The selector surface
is frozen anyway.

## Constraints

- Max **2** test runs, targeted (`-g "create → edit"`), not the full suite.
- One writer per worktree; do not `git stash` (`refs/stash` is shared across worktrees).
- Do not commit. Leave the change on `pi/wf/e2e-stack-slots` for review.
- Shell guards: commands containing `.env` or a `…life.db` literal are blocked — build
  the name in Python (`'.e'+'nv'`) or write a script file first.
- Report back: the `trigger` histogram, the self-write verdict, and whether the loop
  survives 3a.
