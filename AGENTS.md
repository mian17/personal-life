# personal-life — Project Profile & Contracts

## Project Profile
| Knob | Value |
|---|---|
| `typecheck` | `npm run typecheck` (workspace-aware; run in the touched workspace) |
| `unit-test` | `npm run test:unit -- <file>` from the owning workspace (jest; every workspace exposes `typecheck`/`test:unit` — tasks add the scripts when they create or touch a workspace) |
| `e2e-run` | `npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"` (dev mode: `playwright.dev.config.ts`) |
| `max-test-runs` | 2 |
| `frozen-surfaces` | e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`); token values (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md` value table); PWA constants (`public/manifest.json`, `viewport.themeColor`) |
| `hard-lines` | data directories, secrets, ports; production deploys and production data migrations (plan + document checklist — the human runs them) |
| `lessons` | `docs/lessons/` |

Process rules (role, testing policy, delegation, template, review, skills, branch/autonomy,
thinking discipline) are in the global protocol at `~/.config/opencode/AGENTS.md`.

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
   concept is genuinely reusable across apps. Spec-first, always: update
   `docs/specs/SPEC-ui-*.md` (and `MAP-ui-primitives.md` for a new component) in the
   same change, implement in `packages/ui` with tests, then consume from the app.
2. Genuinely app-specific **behavior** (page glue, domain widgets like the editor's
   autosave engine) stays in `apps/*` — but it must be composed FROM primitives and
   may not introduce new visual language. A new visual concept is case 1, not case 2.
3. Forbidden in both cases: inline `style=` for anything a token or variant covers;
   ad-hoc app CSS classes that recreate primitive visuals; per-app component copies;
   raw hex/rgb/px/rem values outside `packages/ui/src/styles/tokens.css`.

### Frozen surfaces (human-owned)

- The e2e selector surface (roles, visible text, aria-labels, `button.trash-delete`):
  never change without the user's explicit approval.
- Token values: a deliberate theme change updates `packages/ui/test/tokens.test.ts` and
  `SPEC-ui-tokens.md`'s value table in the same commit. Those are tripwires, not
  suggestions.
- PWA constants (`public/manifest.json`, `viewport.themeColor`) are app-owned and move
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
- Content-bearing services additionally follow `docs/specs/SPEC-notes-at-rest.md`
  (envelope at rest, `@life/crypto` consumption): this cache contract is one half
  of that at-rest contract.

### Mechanical checks (tech lead runs at every review touching a backend service)

- `grep -rln "getThrough" apps/*/src` → read flows go through the read-through
  cache (or the spec documents the deviation).
- Every cache-write site passes the ciphertext test: the service's cache suite
  asserts serialized values contain `enc.v1.` and no known plaintext (pattern:
  `apps/note-service/test/notes-cache.e2e-spec.ts`).
- `grep -rn "## Cache Rules" docs/specs/SPEC-*.md` → every backend service spec
  has one.
- No content matching in SQL over encrypted columns — filters run in memory
  post-decrypt (`content-match.ts` pattern).

**Delegation plan fields (consumed by the global subagent template):**
- Backend service task → include a "Cache plan": the cached shapes, key composition,
  invalidation, and failure mode this task implements — or the spec's `## Cache Rules`
  section it fulfils. Any gap goes upstream per Rule 4 of this contract — never a
  per-service fork of the read-through cache.
