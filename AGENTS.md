# personal-life — Project Profile & Contracts

## Project Profile

| Knob              | Value                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`       | `npm run typecheck` (workspace-aware; run in the touched workspace)                                                                                                                                                                                                                                                                                        |
| `unit-test`       | `npm run test:unit -- <file>` from the owning workspace (jest; every workspace exposes `typecheck`/`test:unit` — tasks add the scripts when they create or touch a workspace)                                                                                                                                                                              |
| `e2e-run`         | `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"` (dev mode: `playwright.dev.config.ts`)                                                                                                                                                                                                                                     |
| `max-test-runs`   | 2                                                                                                                                                                                                                                                                                                                                                          |
| `frozen-surfaces` | PWA constants (`public/manifest-*.json`, `viewport.themeColor`) — always frozen; e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`) and token values (`packages/ui/test/tokens.test.ts` is the value table) — frozen by default, released per-run by an explicit intent that names them and moves the tests in the same commit |
| `hard-lines`      | data directories, secrets, ports; production deploys and production data migrations (plan + document checklist — the human runs them)                                                                                                                                                                                                                      |
| `lessons`         | `docs/lessons/`                                                                                                                                                                                                                                                                                                                                            |
| `base-branch`     | `dev` — every branch is cut from `origin/dev` and every PR targets `dev`; never `main`                                                                                                                                                                                                                                                                     |

Process rules (role, testing policy, delegation, template, review, skills, branch/autonomy,
thinking discipline) are in the global protocol at `~/.pi/agent/AGENTS.md`.

## Delegation — the mandatory task template

Every subagent prompt in this repo is written in the global protocol's
`## 5. Mandatory Subagent Task Template`, because a lane's scope and testing budget
are only enforceable when they are checkable strings in the prompt. The template
itself lives there and is not copied here — a second copy drifts from the first.
This repo contributes the values below and the two plan-field bullets from the
contracts, so a lane never has to guess what a slot should say.

| Template slot                                               | Where the value comes from                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `[VERIFICATION & TESTING RULES]` → `Permitted test command` | the profile's `unit-test` row — `npm run test:unit -- <file>` from the owning workspace                                                   |
| `[VERIFICATION & TESTING RULES]` → `max test executions`    | the profile's `max-test-runs` row, `2`                                                                                                    |
| `[DEFINITION OF DONE]` → typecheck box                      | the profile's `typecheck` row — `npm run typecheck` in the touched workspace                                                              |
| `[IMPLEMENTATION REQUIREMENTS]`                             | the profile's `frozen-surfaces` row, named as paths the lane may not change, and the `hard-lines` row for anything the human has to run   |
| `[SCOPE & REPOSITORY CONTEXT]`                              | the profile's `base-branch` row — the worktree is cut from `origin/dev`, so the prompt names that branch and never `main`                 |
| `[IMPLEMENTATION REQUIREMENTS]` → plan fields               | Contract 1's delegation plan fields for a UI task (the primitive reuse plan) and Contract 2's for a backend service task (the cache plan) |

Two rules sit in every prompt's `[IMPLEMENTATION REQUIREMENTS]`, in addition to the
slots above:

- A lane commits, pushes, and opens a pull request when its prompt says so — none of
  those is a scope violation. Merging is the parent's alone: a lane never merges a pull
  request. A lane never force-pushes or rewrites shared history, and never stages a file
  outside its allowed list. Stage explicit paths, never `git add -A`; report the commit
  hash and the PR URL so the diff stays in view. The parent keeps the decision, the
  review and the merge.
- No intent, spec, report or task-plan file may be staged, because `docs/intent/`,
  `docs/specs/`, `docs/reports/` and `tasks/` are gitignored run scratch that never
  enters a commit.

## Branching — always from `dev`

`main` is the release line and is never a working base. Cut every branch from
`origin/dev` and open every pull request against `dev`:

```bash
git fetch origin --prune
git -C <base checkout> pull --ff-only origin dev
git worktree add .pi/worktrees/<slug> -b <branch> origin/dev
gh pr create --draft --base dev --head <branch>
```

**Pull before you branch.** Always refresh the base checkout before creating a new
worktree or branch — `git fetch origin --prune` first, then `git pull --ff-only`
on the base branch. A stale base is how a branch silently starts behind `dev`,
which shows up later as a rebase conflict or a diff full of files someone else
already deleted. If the pull is not fast-forward (local commits, or a dirty tree
that conflicts), stop and report it rather than branching anyway: a branch built
on a diverged base is worse than no branch.

Never branch from `main`, never rebase onto `main`, never push to `main` or to `dev`
directly, and never merge a pull request — the parent merges, and only when the user
asks. Promotion from
`dev` to `main` is a human decision, not part of any task.

This applies to agents too, including short mechanical ones such as the
`scripts/sonar-autofix` run — that receiver fetches `origin/dev` and branches from
it for every run, and never targets `main`.

Worktrees live under `.pi/worktrees/` (gitignored), not `.worktrees/` at the repo
root and not `~/.cache` — the sandbox mounts the repository and nothing else.

Docs layout: `docs/specs/`, `docs/intent/` and `tasks/` were removed in `d1f54c9` and
are not restored wholesale — a run that needs a spec writes `docs/specs/SPEC-<module>.md`
(or `SPEC.md` at the root for a single capability) and an intent writes
`docs/intent/<topic>.md`, so `agents-hard-gates` keeps working unchanged.

## Releasing — a merged promotion is not a release

A release is a tag plus a GitHub release, on the commit you ship. Promoting
`dev` to `main` records the release line; it does not tag anything.

```bash
npm run release -- <version>        # bump, PR into dev, wait for CI, tag, release
```

The script refuses unless the tree is clean, HEAD is `origin/dev` (or `--ref`),
the tag is new, the notes file exists at `docs/releases/<version>.md`, and CI is
green on that exact SHA. It then bumps `package.json`, lands that bump on
`chore/release-v<x>` through a pull request into `dev` merged with `--merge`
(never squashed — the tag names that commit), waits for every workflow on the
bump commit's own SHA, and only then tags and runs `gh release create`. So CI has
to be green twice over: on the pre-bump HEAD, and again on the bump commit.
Never tag by hand: the hand-tagged path is the one that
gets skipped. House style for the notes, and what the script deliberately leaves
to you, are in `docs/runbooks/release.md`.

## Contract 1 — Shared UI Contract (`@life/ui`)

Every frontend app (current and future) renders its UI from `@life/ui` (atoms + blocks)
and takes its colors/spacing/radii/type from `@life/ui` tokens. The package is the
single owner of the visual language; apps own domain behavior and nothing visual.

### Rule 1 — a raw HTML element is not an implementation

If you are writing a bare `<button>`, `<input>`, `<textarea>`, `<select>`, `<a>`,
`<img>`, `<label>`, `<progress>`, or a styled `<div>`/`<span>` in `apps/*` UI code,
you have taken a wrong turn — that markup is a symptom, not an implementation. Stop
and go to Rule 2 or Rule 3.

Structural exceptions (tags with **zero** visual responsibility):

- `div`, `span`, `p`, `form`, fragments — allowed only as behavior/glue containers
  with no `className` styling and no inline `style` (e.g. a server-action `<form>`
  whose visuals come from the primitives inside it).
- Elements that do not render (hidden inputs, `meta`, `script`) — plumbing, exempt.
- `app/layout.tsx`'s `html`/`body`/`script` — Next framework plumbing, exempt.

The moment one of these exemptions needs a class or style to look right, it has become
a visual element and Rule 3 applies.

### Rule 2 — when a primitive exists

- Compose it. Never hand-roll markup or CSS that recreates a primitive's visuals.
- Never fork, copy, or wrap-reimplement a primitive inside an app. Never add a second
  app-wide stylesheet; `@life/ui/styles.css` is imported exactly once in the root layout.
- Style through tokens only (`var(--token)`). No raw colors or lengths in app CSS.
- A fit problem (missing prop, wrong shape) is fixed **upstream** — a prop, slot, or
  variant in `packages/ui` — never worked around in the app.

### Rule 3 — when no primitive fits

1. Extend `@life/ui` upstream. Prop/slot/variant first; a new atom/block only when the
   concept is genuinely reusable across apps. Spec-first, always: write the spec
   `docs/specs/SPEC-ui-*.md` (and a `MAP-ui-primitives.md` entry for a new component)
   before the code, implement in `packages/ui` with tests, then consume from the app.
   The spec lives on disk only — `docs/specs/` is gitignored per-run scratch, so it is
   never staged and never committed. It is still the standard the change is judged
   against, so being uncommitted does not lower the bar.
2. Genuinely app-specific **behavior** (page glue, domain widgets like the editor's
   autosave engine) stays in `apps/*` — but it must be composed FROM primitives and
   may not introduce new visual language. A new visual concept is case 1, not case 2.
3. Forbidden in both cases: inline `style=` for anything a token or variant covers;
   ad-hoc app CSS classes that recreate primitive visuals; per-app component copies;
   raw hex/rgb/px/rem values outside `packages/ui/src/styles/tokens.css`.

### Frozen surfaces (human-owned)

- The e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`):
  never change without the user's explicit approval.
- Token values: a deliberate theme change updates `packages/ui/test/tokens.test.ts` in the
  same commit. Those are tripwires, not suggestions.
- PWA constants (`public/manifest-*.json`, `viewport.themeColor`) are app-owned and move
  only when the user asks.

### Mechanical checks (tech lead runs at every review touching UI)

- `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
  → zero hits in UI code (Rule 1's exemptions only).
- `grep -rn "next/link" apps --include='*.tsx'` → zero hits (anchors are
  `IconLink`/`FabLink`/`ListItem`/`Pill as="a"` — `packages/ui` owns `next/link`).
- `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'`
  → hits only inside `packages/ui/src/styles/tokens.css`.
- `grep -riE "note|trash|tag-chip" packages/ui/src` → zero hits in code
  (the CSS mapping-table comments are the documented exemption).
- No `.tsx` in `apps/*` re-implements a `packages/ui` component's markup.

**Delegation plan fields (consumed by the global subagent template):**

- UI task → include a "Primitive reuse plan": which `@life/ui` primitives compose this,
  element by element. Any gap goes upstream per Rule 3 of this contract — never patched
  around in the app, never solved with raw HTML.

## Contract 2 — Backend Data-Layer Contract (BE → cache → DB)

Every backend service that serves domain data is built in exactly three layers, in
this order — `note-service` is the reference implementation
(`apps/note-service/src/notes/notes-cache.ts` + `notes.service.ts`):

```
request → BE (service: authz, domain logic, encrypt/decrypt)
        → cache (read-through, Redis)
        → DB (reached only through the cache's loader)
```

The cache is part of the architecture, not an optimization bolted on later. When
planning a backend service, this layering is decided in the spec phase, not
improvised at implementation time.

### Rule 1 — the DB sits behind the cache, not beside it

- Read flows go through the cache's read-through loader; repository/query-manager
  access lives inside the loader, nowhere else.
- Write flows go BE → DB, then invalidate (bump the owner's generation counter).
  The cache is never the source of truth and never absorbs writes silently.

### Rule 2 — cached values are rows as persisted, never presentation

- The cache stores serialized DB rows exactly as stored. For content-bearing
  services that means **ciphertext** (`enc.v1.` envelopes via `@life/crypto`) — the
  cache is inside the at-rest boundary (Redis is AOF-persistent; a decrypted DTO in
  Redis is a data-privacy breach).
- Decrypt, assemble DTOs, filter, and paginate **after** every cache hit. Plaintext
  exists only in the request path.

### Rule 3 — the cache key reflects the fetch, not the request

- Key shape: `<svc>:<sub>:v<gen>:<rest>`, with per-owner isolation.
- Content filters (`q`, tag filters) and pagination (`cursor`, `limit`) never enter
  the key — one entry serves every filter/page variant.
- Invalidation contract: per-owner generation counter bumped on successful writes,
  TTL as backstop, fail-open on any cache error (degrade to the direct loader —
  the cache may never cause unavailability, and the fallback path must not write
  plaintext).

### Rule 4 — planning and reuse

- Every backend service spec MUST contain a `## Cache Rules` section stating the
  cached shapes, key composition, invalidation, and failure mode. A plan or task
  list without a cache-layer task is incomplete. A service that deliberately ships
  without a cache records the deviation and its rationale in the spec (rare).
- The second service must NOT fork `notes-cache.ts` — extract the generic
  read-through cache into a shared workspace package first (same no-fork rule as
  `@life/ui`).
- Content-bearing services additionally follow the notes at-rest contract — envelope at
  rest, `@life/crypto` consumption, written per run as
  `docs/specs/SPEC-notes-at-rest.md`. This cache contract is one half of that at-rest
  contract.

### Mechanical checks (tech lead runs at every review touching a backend service)

- `grep -rln "getThrough" apps/*/src` → read flows go through the read-through
  cache (or the spec documents the deviation).
- Every cache-write site passes the ciphertext test: the service's cache suite
  asserts serialized values contain `enc.v1.` and no known plaintext (pattern:
  `apps/note-service/test/notes-cache.e2e-spec.ts`).
- Every backend service spec carries a `## Cache Rules` section → the service has one.
  A service you touch gets its spec written or updated for the change, on disk only
  (`docs/specs/` is gitignored), because the review checks the service against it.
- No content matching in SQL over encrypted columns — filters run in memory
  post-decrypt (`content-match.ts` pattern).

**Delegation plan fields (consumed by the global subagent template):**

- Backend service task → include a "Cache plan": the cached shapes, key composition,
  invalidation, and failure mode this task implements — or the spec's `## Cache Rules`
  section it fulfils. Any gap goes upstream per Rule 4 of this contract — never a
  per-service fork of the read-through cache.
