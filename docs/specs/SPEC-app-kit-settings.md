# Spec: app-kit-settings — preference cookie + Settings-route glue

Module id: `app-kit-settings` (map: `docs/specs/MAP-settings-and-matrix.md`). Depends on
`app-kit` (build order only; no code import). Behavior owner: `@life/app-kit`.

## Objective

The behavior glue behind the shared Settings surface: a **server-readable preference
cookie** (`readPref` / `setPref`) and the **app-scoped Settings-route helper**
(`settingsHref`). This is the mechanism of map decision **D1** — the matrix opt-in gates a
server-side route, so it must be readable on the server before render; a cookie is the only
storage that is. Theme is explicitly **not** migrated: it stays on `ThemeToggle`'s
existing localStorage mechanism (read by the inline script in
`apps/app/app/layout.tsx:19`), because it is a client-only visual and needs no server read.

`app-kit-settings` is **behavior only, no markup**. It stores and returns values and builds
an href. The gear `IconLink` and the whole settings-page composition are `@life/ui`'s
(`ui-settings`, `SPEC-ui-settings.md`); the app renders them with app-kit's href and the
values app-kit returns. Success = any app reads/writes a preference and reaches its
settings route through `@life/app-kit` with zero app-local cookie or path-join code.

## Public API (exported signatures)

```ts
// src/types.ts (extended)
/**
 * A known preference key. app-kit holds **no** concrete keys — an app declares its
 * own union (e.g. `type AppPrefKey = 'matrix'`) and extends it to add a preference.
 * Never fork these helpers per app or per key.
 */
export type PrefKey = string;

// src/preferences.ts  (server-only: imports `next/headers`)
/** The cookie name for a preference: `pref_<name>`, e.g. `pref_matrix`. */
export function prefCookieName<K extends string>(name: K): string;
/**
 * Parse a raw cookie value into the preference's boolean state:
 * `'on' → true`; `'off'`, `undefined`, or any malformed value → `false` (OFF).
 */
export function parsePrefValue(raw: string | undefined): boolean;
/**
 * Read a preference server-side (server component / route). Absent or malformed
 * cookies resolve to `false` (the OFF default). Fail-safe: never throws — a read
 * outside a request scope, or any cookie-store error, also returns `false`.
 */
export function readPref<K extends string>(name: K): Promise<boolean>;

// src/preference-action.ts  ('use server')
/**
 * Persist a preference and revalidate the app so the gated route re-renders.
 * A Server Action (called from the `Switch` in the settings page). `value`
 * encodes to `'on'` / `'off'`; the cookie is written with the options below.
 */
export function setPref<K extends string>(name: K, value: boolean): Promise<void>;

// src/settings-route.ts
/**
 * The app-scoped settings path: `settingsHref('/todos') === '/todos/settings'`,
 * `settingsHref('/notes') === '/notes/settings'`. A trailing slash on `route` is
 * normalized so the join never yields `//settings`.
 */
export function settingsHref(route: RoutePath): string;
```

```ts
// src/index.ts — the barrel (added to the existing exports)
export type { PrefKey } from './types';
export { prefCookieName, parsePrefValue, readPref } from './preferences';
export { setPref } from './preference-action';
export { settingsHref } from './settings-route';
```

### Subpath export — the client-safe action entry

The barrel (`.`) stays the **read path**: `readPref` (server-only — it imports
`next/headers`), `settingsHref`, and `PrefKey`. The `'use server'` **action** is also exposed
as its own subpath export, `@life/app-kit/preference-action`, because a client component that
imports `setPref` through the barrel (or through an app barrel that re-exports it, e.g.
`@/lib/preferences`) would drag the server-only `readPref`/`next/headers` into the client
graph — the barrel re-exports both. `packages/app-kit` therefore declares:

```json
// packages/app-kit/package.json
"exports": {
  ".": "./src/index.ts",
  "./preference-action": "./src/preference-action.ts"
}
```

The consuming app must map that subpath in **two** places, because ts-jest resolves with
`moduleResolution: node` (which does not read `package.json#exports`):

```json
// apps/app/tsconfig.json — compilerOptions.paths
"@life/app-kit/preference-action": ["../../packages/app-kit/src/preference-action.ts"]

// apps/app/package.json — jest.moduleNameMapper
"^@life/app-kit/preference-action$": "<rootDir>/../../packages/app-kit/src/preference-action.ts"
```

With all three in place, `import { setPref } from '@life/app-kit/preference-action'`
typechecks under the prod build and resolves under the app's ts-jest, and the client graph
contains no `readPref`/`next/headers` (Next replaces the `'use server'` module with an action
reference in a client bundle).

### Preference cookie contract

- **Name:** one cookie per preference, `pref_<name>` (`prefCookieName`). Keys are
  code-defined literals, not user input; the `pref_` prefix keeps them clear of
  `app_session` / `login_attempt`. Per-key cookies (not one JSON blob) mean a new
  preference never rewrites an existing one and `readPref(name)` needs no parse of
  unrelated state.
- **Value encoding:** `'on' | 'off'` (internal `PrefValue`; not exported). The public
  surface is `boolean` — `readPref` returns it, `setPref` accepts it. Any value other
  than exactly `'on'` reads as OFF, so a corrupted/legacy cookie degrades safely.
- **Attributes:** `path: '/'`, `sameSite: 'lax'`, `secure` from the caller (the
  dev-stack flag `APP_DEV_SKIP_ACCESS_GATE=1`; `NODE_ENV` is never consulted),
  `maxAge: 365 * 24 * 60 * 60` (one year — long-lived; the user's
  preference is durable and the cookie is refreshed on each write).
- **`httpOnly: true`** — chosen deliberately. The value is not secret, but **only the
  server reads it** (the route gate and the settings page render server-side), so
  httpOnly costs nothing and takes the value out of reach of client scripts — least
  privilege. Nothing in the client needs to read the cookie.
- **Invalidation/write flow:** write is BE-free and side-effect-free beyond the cookie:
  the Server Action sets the cookie and `revalidatePath('/', 'layout')`s the app (a
  preference can gate any route, so a generic action cannot name just one). The
  re-render then reads the new value through `readPref`.

### Semantics and edge cases

**`readPref`**
- `await cookies()` (Next 15 async store, matching `apps/app/lib/auth/require-session.ts:19`)
  then `parsePrefValue(store.get(prefCookieName(name))?.value)`.
- Absent cookie, `''`, `'off'`, `'ON'`, `'1'`, `'true'` → `false`. Only exact `'on'` is
  true.
- Wrapped so it **never throws**: a `cookies()` call outside a request scope (e.g. a
  unit test with no store) still returns `false`, the OFF default.

**`setPref`**
- Marks the file `'use server'`; every export is a Server Action and it is importable
  only from a client component (the settings `Switch`). It must **not** live beside
  `readPref` — a `'use server'` module makes all exports client-only actions, which
  would break the server-side read.
- Writes `pref_<name>` = `value ? 'on' : 'off'` with the attributes above, then
  `revalidatePath('/', 'layout')`.
- The action is a plain setter; the calling switch owns debouncing. The settings
  `MatrixSwitch` (`apps/app/app/settings/matrix-switch.tsx`) coalesces rapid toggles
  through the shared `useDebouncedCallback` and calls `setPref('matrix', next)` only
  once the user settles (a return to the seeded value sends nothing, and a pending
  write is flushed on unmount), so one gesture burst yields one cookie write + one
  revalidation.

**`settingsHref` / the nav entry**
- Pure string join; `path`-free and markup-free. The Settings `IconLink` entry is
  assembled in the app: `href={settingsHref('/todos')}`, `label="Settings"`, and the
  lucide `Settings` icon node — the label and the icon are visible app text/markup and
  stay in `apps/app`, exactly as the current nav links do. app-kit contributes only the
  href and the read/write glue. **app-kit owns no markup.**
- The path convention is app-scoped (`/todos/settings`, `/notes/settings`), so it stays
  inside each per-route PWA's identity (lesson 0005) — the settings route is a page of
  the route's app, not a new manifest/scope.

## Tech Stack

Same shape as `@life/app-kit`: React 19 TS source consumed directly (no build step),
`next` as a peer, `transpilePackages` already lists `@life/app-kit`
(`apps/app/next.config.mjs:4`). `next/headers` (`cookies`) and `next/cache`
(`revalidatePath`) enter here and only here. `@life/ui` is not imported — this module is
behavior only. Standard library only; no new dependency.

## Commands

No build step — `src/**` is the distributed source.

- Typecheck / lint: `npm run typecheck -w packages/app-kit`
- Unit tests: `npm run test:unit -w packages/app-kit -- test/<file>`

## Project Structure

```
packages/app-kit/src/preferences.ts        # prefCookieName, parsePrefValue, readPref; imports next/headers
packages/app-kit/src/preference-action.ts  # 'use server' — setPref; imports next/headers, next/cache
packages/app-kit/src/settings-route.ts     # settingsHref
packages/app-kit/src/types.ts              # + PrefKey
packages/app-kit/src/index.ts              # barrel additions (read path + settingsHref + PrefKey)
packages/app-kit/package.json              # + "./preference-action" subpath export (client-safe action entry)
packages/app-kit/test/pref-cookie.test.ts      # name + value parsing
packages/app-kit/test/read-pref.test.ts        # cookie read via the headers stub
packages/app-kit/test/set-pref.test.ts         # server-action write + options + revalidate
packages/app-kit/test/settings-route.test.ts   # path join / trailing-slash normalization
packages/app-kit/test/stubs/next-headers.ts    # mutable cookies() stub
packages/app-kit/test/stubs/next-cache.ts      # revalidatePath spy
```

`package.json`'s jest `moduleNameMapper` gains two entries beside the existing
`^next/navigation$` stub: `"^next/headers$": "<rootDir>/test/stubs/next-headers.ts"`
and `"^next/cache$": "<rootDir>/test/stubs/next-cache.ts"`. No dependency changes —
`server-only` is documented, not imported (the `next/headers` import already fails in a
client bundle; the existing `loadOrNotFound` sets the same documented-server-only
precedent).

## Code Style

The app supplies its keys and its route; the helpers hold no concrete key and no path
literal:

```ts
// apps/app/lib/preferences.ts (app-owned)
import { readPref, setPref } from '@life/app-kit';
/** Extend this union to add a preference — never fork the helpers. */
export type AppPrefKey = 'matrix';
export { readPref, setPref };
```

```tsx
// apps/app/app/todos/matrix/page.tsx (the server-side gate, D3)
import { notFound } from 'next/navigation';
import { readPref } from '@/lib/preferences';
if (!(await readPref('matrix'))) notFound();
```

```tsx
// apps/app/app/todos/page.tsx navTrailing (rendering is @life/ui's; href is app-kit's)
import { settingsHref } from '@life/app-kit';
<IconLink href={settingsHref('/todos')} label="Settings">
  <Settings size={20} aria-hidden />
</IconLink>
```

Conventions, matching `app-kit`: named exports only, `type`-only exports for interfaces,
no default exports, no domain identifiers. The only key literal (`'matrix'`) lives in
`apps/app`, never in this package.

## Testing Strategy

Same harness as `@life/app-kit` (jest + `ts-jest`, jsdom; `next/headers`/`next/cache`
stubbed). One suite per export:

- `pref-cookie.test.ts` — `prefCookieName('matrix') === 'pref_matrix'`; the parse matrix
  (`'on' → true`; `'off' | undefined | '' | 'ON' | '1' | 'true' → false`).
- `read-pref.test.ts` — a stubbed cookie store returning `'on' → true`, absent/
  malformed → false; a stub that throws still resolves `false` (never throws); the name
  passed to `get` is `pref_<key>`.
- `set-pref.test.ts` — `setPref('matrix', true)` calls `store.set('pref_matrix', 'on',
  { path: '/', sameSite: 'lax', httpOnly: true, secure: <env>, maxAge: 31536000 })`;
  `false` writes `'off'`; `revalidatePath('/', 'layout')` is called.
- `settings-route.test.ts` — `/todos → /todos/settings`, `/notes → /notes/settings`;
  a trailing-slash route yields no `//settings`.

No E2E here. The page wiring that consumes these lives in `matrix-ui`.

## Boundaries

- **Always:** keep the exported signatures above stable within this module; keep
  `readPref` fail-safe to `false` and non-throwing; keep `setPref` a `'use server'`
  action; keep `settingsHref` a pure string join; keep app-kit free of any concrete
  preference key.
- **Ask first:** adding any export beyond the list above; changing the cookie name
  prefix, value encoding, or attributes; migrating theme storage.
- **Never (hard exclusions):**
  - **any visual markup or styling** — no JSX, no `IconLink`, no `Switch`, no label
    text, no CSS; the gear entry and the settings page are `@life/ui`'s (`ui-settings`)
    rendered by the app;
  - a concrete preference key (`'matrix'`) or route path (`/todos`) inside the package;
  - `ThemeToggle` / theme persistence — theme explicitly stays on its existing
    localStorage mechanism (D1); this module does not touch it;
  - the `apps/app` API clients, the server-action quartet, `lib/auth/**`, and any
    domain type (`Note`/`Todo`/`List`);
  - reimplementing the read-through cache or any backend service — a preference is
    device-local UI state, not domain data.

## Success Criteria

1. `prefCookieName`, `parsePrefValue`, `readPref`, `setPref`, `settingsHref`, and the
   `PrefKey` type exist with the declared signatures. The **one** intended addition to the
   public surface beyond that list is the `@life/app-kit/preference-action` subpath export
   (the client-safe entry to the `setPref` action); there is no other extra public surface.
2. The preference cookie is `pref_<key>` encoding `'on' | 'off'` with `path=/`,
   `sameSite=lax`, `httpOnly`, long-lived `maxAge`; `readPref` returns `false` on
   absent/malformed/error and never throws.
3. `setPref` is a `'use server'` action that writes the cookie and revalidates the app.
4. `settingsHref` yields the app-scoped settings path for both `/todos` and `/notes`.
5. `grep -rnE "matrix|/todos|/notes|<IconLink|Switch" packages/app-kit/src` finds no
   concrete key, route literal, or markup **in code**; documentation-comment examples (the
   spec's own `'matrix'`/`pref_matrix`/`Switch` illustrations and the pre-existing
   `types.ts` / `preserving-search-box.tsx` route examples) are the documented exemption,
   mirroring the repo's UI-grep convention.
6. Theme still reads/writes localStorage in `ThemeToggle` and `apps/app/app/layout.tsx`;
   nothing here migrated it.
7. `npm run typecheck -w packages/app-kit` is clean and
   `npm run test:unit -w packages/app-kit` is green.

## Open Questions

- None. The map (D1, D3) fixes the storage reach and the route path; the signatures above
  are owned here.
