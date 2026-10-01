# Spec: app-kit — shared non-visual page/route glue

Module id: `app-kit` (map: `docs/specs/MAP-shared-page-blocks.md`). Depends on `ui-blocks`.

## Objective

One workspace package holding the page/route **behavior glue** that the notes and todos
segments currently duplicate: the filter-href builder, the `tag`-param parser, the
parameter-preserving search box, the create/edit `load-or-notFound()` helper, the
route-layout metadata helper, and the shared param types those functions exchange. It
additionally owns the Settings surface's behavior glue: the server-readable preference
cookie (`readPref`/`setPref`) and the app-scoped settings-route helper (`settingsHref`) —
specified in `SPEC-app-kit-settings.md`.

`app-kit` is **behavior only**. It owns routing/URL glue and Next's `notFound()` flow; it
owns no markup, no visual language, and no data fetching. Visual primitives stay in
`@life/ui` (the search box composes `@life/ui`'s `SearchField`; it never reimplements it);
the domain API clients and data-mutating server actions stay in `apps/app` (the generic
preference-cookie action is behavior glue and lives here, per `SPEC-app-kit-settings.md`).

Success = `apps/app/app/notes/**` and `apps/app/app/todos/**` each keep zero copies of the
five patterns below; a third segment gets them from `@life/app-kit` instead of copying a
route file. Frozen surfaces (e2e selector surface, token values) are untouched: the kit
emits no roles, text, labels, or styles of its own.

## Public API (exported signatures)

```ts
// src/types.ts
/** A route prefix used verbatim, e.g. `/notes` (absolute) or `list` (relative). */
export type RoutePath = string;
/** A bag of query params; string values, absent keys and empty strings are dropped. */
export type QueryParams = Readonly<Record<string, string | undefined>>;

// src/filter-href.ts
export interface FilterHrefInput {
  /** Route prefix, used verbatim (leading `/` for absolute hrefs). */
  path: RoutePath;
  /** The full current param bag — every key that must survive the change. */
  current?: QueryParams;
  /** Per-key overrides; `undefined` or `''` removes that key. */
  overrides?: QueryParams;
}
/**
 * Build a route href carrying the current params, overriding the given axes and
 * dropping every emptied one. Generic form of notes' `filterHref` and todos'
 * `todoHref`.
 */
export function filterHref(input: FilterHrefInput): string;

// src/parse-tag-id.ts
/**
 * Parse a `tag` search param into a numeric id. Returns `undefined` when the
 * value is absent or not a non-negative integer string (`/^\d+$/`), matching the
 * guarded `Number(tag)` used by both list pages.
 */
export function parseTagId(raw: string | undefined): number | undefined;

// src/load-or-not-found.ts
/** True when `error` is 404-shaped: a non-null object whose `status === 404`. */
export function isNotFoundStatus(error: unknown): boolean;
export interface LoadOrNotFoundOptions {
  /** Override the default 404 predicate. */
  isNotFound?: (error: unknown) => boolean;
}
/**
 * Await a loader and, if it throws a not-found error, call Next's `notFound()`;
 * otherwise rethrow. Server-only (Next control flow) — never import into a
 * client component.
 */
export function loadOrNotFound<T>(
  load: () => Promise<T>,
  options?: LoadOrNotFoundOptions,
): Promise<T>;

// src/route-layout.tsx
/** The `{ manifest }` metadata shared by every route-segment layout. */
export function routeLayoutMetadata(manifest: string): Metadata;
/** The passthrough layout body (`<>{children}</>`) every segment layout uses. */
export function RouteLayout(props: { children: React.ReactNode }): React.ReactElement;

// src/preserving-search-box.tsx  ('use client')
export interface PreservingSearchBoxProps {
  /** Route to replace, e.g. `/notes` or `/todos`. */
  path: RoutePath;
  /** Controlled current query value. */
  q?: string;
  /** Other params to preserve verbatim; `q` is owned by this component. */
  params?: QueryParams;
  /** Accessible label for the underlying `@life/ui` `SearchField`. */
  label: string;
  /** Placeholder; defaults to `label`. */
  placeholder?: string;
}
/**
 * Parameter-preserving search box: composes `@life/ui`'s `SearchField` and owns
 * only the `useRouter` / `URLSearchParams` / `router.replace(..., {scroll:false})`
 * glue. Debounce belongs to `SearchField`.
 */
export function PreservingSearchBox(props: PreservingSearchBoxProps): React.ReactElement;

// src/index.ts — the barrel
export type { QueryParams, RoutePath } from './types';
export { filterHref } from './filter-href';
export type { FilterHrefInput } from './filter-href';
export { parseTagId } from './parse-tag-id';
export { isNotFoundStatus, loadOrNotFound } from './load-or-not-found';
export type { LoadOrNotFoundOptions } from './load-or-not-found';
export { RouteLayout, routeLayoutMetadata } from './route-layout';
export { PreservingSearchBox } from './preserving-search-box';
export type { PreservingSearchBoxProps } from './preserving-search-box';
```

### Semantics and edge cases

**`filterHref`**
- Merge: `merged = { ...current, ...overrides }`, preserving the insertion order of
  `current`'s keys and appending override-only keys.
- Emit each key whose merged value is a non-empty string; **drop** keys whose value is
  `undefined` or `''`. `overrides[key] = undefined` therefore removes a key that
  `current` set.
- Values are never coerced — callers pass strings (`String(tagId)`); encoding is
  `URLSearchParams`'s job.
- Output: `params.toString() === '' ? path : `${path}?${params.toString()}``. No trailing
  `?`. An absolute `path` (`/notes`) yields an absolute href; a relative `path` is
  emitted verbatim.
- Query-string key order is insertion order and is **not** contractual (query semantics
  are order-independent); tests compare parsed params, not raw strings.
- Call-site shape today: notes `{ path: '/notes', current: { tag, q }, overrides: { tag } }`
  where `overrides.tag` is `undefined` for "All" or `String(t.tagId)` for a tag; todos
  `{ path: '/todos', current: { q, list, tag, done }, overrides: { tag: undefined } }` etc.

**`parseTagId`**
- `undefined → undefined`; `'' → undefined`; `'12' → 12`; `'012' → 12`;
  `'-1' | '1.5' | '1a' | 'x' → undefined`.
- Values beyond `Number.MAX_SAFE_INTEGER` are passed to `Number` as-is (out of contract).

**`loadOrNotFound`**
- `try { return await load() } catch (e) { if (isNotFound(e)) notFound(); throw e }`.
- `notFound()` throws Next's control-flow signal; the helper never returns in that path.
- Default predicate is `isNotFoundStatus` (duck-typed `status === 404`), so app-kit needs
  no dependency on `apps/app`'s `ApiError` class; it can be overridden via options.
- Runs only where `notFound()` is legal — server components / route render. A client
  import is a misuse; documented as server-only.

**`routeLayoutMetadata` / `RouteLayout`**
- `routeLayoutMetadata('/manifest-notes.json')` returns `{ manifest: '/manifest-notes.json' }`.
- `RouteLayout` is the framework-required passthrough default export; it renders a bare
  fragment (`<>{children}</>`) with zero visual responsibility.

**`PreservingSearchBox`**
- Renders `<SearchField label={label} placeholder={placeholder ?? label} value={q}
  onQueryChange={handler} />` — label/placeholder pass through verbatim to preserve the
  current accessible names.
- `handler(value)` runs
  `router.replace(filterHref({ path, current: { ...params, q }, overrides: { q: value } }),
  { scroll: false })`. `value === ''` drops `q`; every non-empty `params` entry survives.
- `params` carries every non-query param; if it contains `q`, the `q` prop wins.
- Adds no debounce and no `scroll` behavior of its own beyond `{ scroll: false }`.

## Tech Stack

Same shape as `@life/ui`: React 19 TS/TSX **source consumed directly** (no build step),
`next` as a peer. Unlike `@life/ui`, only *one* visual element is used — `SearchField` from
`@life/ui` — composed, never reimplemented. `next/navigation` (`useRouter`, `notFound`) and
`next` (`Metadata`) enter here and **only** here; `packages/ui` stays free of them.
`URLSearchParams` is the standard-library query engine. No CSS, no tokens, no domain types.

## Commands

No build step — `src/**` is the distributed source, exactly like `@life/ui`.

- Typecheck / lint: `npm run typecheck -w packages/app-kit` (and `npm run lint -w packages/app-kit`)
- Unit tests: `npm run test -w packages/app-kit` and the targeted
  `npm run test:unit -w packages/app-kit -- <file>`

The root `npm run typecheck` / `npm test` pick the package up via
`--workspaces --if-present` once it is added to the root `workspaces` array.

## Project Structure

```
packages/app-kit/package.json               # @life/app-kit — scripts + jest config
packages/app-kit/tsconfig.json              # mirror of packages/ui/tsconfig.json
packages/app-kit/tsconfig.test.json         # mirror of packages/ui/tsconfig.test.json
packages/app-kit/src/index.ts               # barrel (exports as specified above)
packages/app-kit/src/types.ts               # RoutePath, QueryParams
packages/app-kit/src/filter-href.ts         # filterHref
packages/app-kit/src/parse-tag-id.ts        # parseTagId
packages/app-kit/src/preserving-search-box.tsx  # 'use client' — PreservingSearchBox
packages/app-kit/src/load-or-not-found.ts   # isNotFoundStatus, loadOrNotFound
packages/app-kit/src/route-layout.tsx       # routeLayoutMetadata, RouteLayout
packages/app-kit/test/filter-href.test.ts
packages/app-kit/test/parse-tag-id.test.ts
packages/app-kit/test/preserving-search-box.test.tsx
packages/app-kit/test/load-or-not-found.test.ts
packages/app-kit/test/route-layout.test.tsx
packages/app-kit/test/stubs/next-navigation.tsx # useRouter stub for jsdom tests
```

`packages/app-kit` is added to the root `package.json` `workspaces` array (after
`packages/ui`).

### Package facts (decided from the `@life/ui` precedent)

`packages/ui/package.json` is a private TS-source package: `"main": "src/index.ts"`,
`"types": "src/index.ts"`, `"exports": { ".": "./src/index.ts" }`, and **no** `build`/`dev`
script; `typecheck`/`lint` are `tsc --noEmit`, `test`/`test:unit` are `jest`. `app-kit`
mirrors that exactly:

- Name: `@life/app-kit`, `"private": true`, version `0.1.0`.
- `"main": "src/index.ts"`, `"types": "src/index.ts"`,
  `"exports": { ".": "./src/index.ts" }`.
- Scripts: `"lint": "tsc --noEmit"`, `"typecheck": "tsc --noEmit"`, `"test": "jest"`,
  `"test:unit": "jest"`.
- `dependencies`: `"@life/ui": "*"` (the one composed primitive).
- `peerDependencies`: `next`, `react`, `react-dom` (as `@life/ui` declares them).
- `devDependencies`: the same test toolchain as `@life/ui`
  (`@testing-library/react`, `@types/jest`, `@types/node`, `@types/react`, `jest`,
  `jest-environment-jsdom`, `react`, `react-dom`, `ts-jest`, `typescript`).
- `jest` config mirrors `@life/ui`'s (`ts-jest` transform with `tsconfig.test.json`,
  `testRegex: "\\.test\\.tsx?$"`, `testEnvironment: "jsdom"`, `rootDir: "."`), with
  `moduleNameMapper` adding `"^next/navigation$": "<rootDir>/test/stubs/next-navigation.tsx"`
  (the analogue of `@life/ui`'s `^next/link$` stub).
- `tsconfig.json` / `tsconfig.test.json` mirror `packages/ui`'s (extend
  `../../tsconfig.base.json`; `jsx: react-jsx`, `module: esnext`,
  `moduleResolution: bundler`, `noEmit`, `isolatedModules`, `include: ["src/**/*",
  "test/**/*"]`; the test config flips to `commonjs`/`node` and `noEmit: false`).

## Code Style

Functions are small, pure where possible, and accept params as values — never read
`searchParams` themselves. A route file passes its own data and copy:

```tsx
// apps/app/app/todos/page.tsx (after the port)
import { filterHref, parseTagId, PreservingSearchBox } from '@life/app-kit';

const tagId = parseTagId(tag);

<PreservingSearchBox
  path="/todos"
  q={q}
  params={{ list, tag, done }}
  label="Search todos"
/>

const tagFilterItems = namedTags.map((t) => ({
  name: t.name,
  href: filterHref({ path: '/todos', current: { q, list, tag, done }, overrides: { tag: String(t.tagId) } }),
  active: tagId === t.tagId,
}));
```

Conventions: named exports only, `type`-only exports for interfaces, no default exports
(except the `RouteLayout` used as a Next default), no domain identifiers (`Note`, `Todo`,
`List`) anywhere in the package.

## Testing Strategy

Same harness as `@life/ui` (jest + `ts-jest` + `@testing-library/react`, jsdom). One suite
per export, tests in `packages/app-kit/test/**`:

- `filter-href.test.ts` — param preservation across an override; emptied keys dropped
  (`undefined` and `''`); unknown keys preserved; no trailing `?`; absolute vs relative
  `path`; round-trips parsed params for the notes/todos call shapes.
- `parse-tag-id.test.ts` — the accepted/rejected matrix above.
- `preserving-search-box.test.tsx` — renders a labelled `searchbox`; fake-timer debounce
  (reuses `SearchField`'s 300ms — the box emits nothing itself); `router.replace` called
  once with the merged href and `{ scroll: false }`; `q` dropped when empty; sibling
  params preserved. A source assertion that the component contains no `fetch(` / no
  visual markup beyond `SearchField`.
- `load-or-not-found.test.ts` — passes a value through; calls the not-found path when the
  loader throws a 404-shaped error (`notFound` mocked); rethrows other errors; honours a
  custom `isNotFound`.
- `route-layout.test.tsx` — metadata object shape; `RouteLayout` renders children with no
  wrapper element.

No e2e here. The port that wires these consumers is `segment-port`.

## Boundaries

- **Always:** keep the exported signatures above stable within this module; pass
  label/placeholder through unchanged so accessible names (frozen surface) are identical;
  return absolute hrefs verbatim; keep everything server-safe except the one `'use client'`
  component.
- **Ask first:** adding any export beyond the list above; moving any data-layer file into
  the package; introducing a new dependency (including a general read-through cache).
- **Never (hard exclusions — stay in `apps/app`):**
  - the three `call<T>` API clients (`apps/app/lib/api.ts`, `lib/todo-api.ts`,
    `lib/tags-api.ts`) and any fetching;
  - the `delete` / `restore` / `deleteForever` / `emptyTrash` server-action quartet
    (`app/actions.ts`, `app/todo-actions.ts`);
  - `lib/auth/**` and session/token handling;
  - the note autosave engine, `splitBody`, inline `#tag` parsing, note tag composition,
    todo grouping/cursor walk, and the lists concept;
  - **any visual markup or styling** — that is `@life/ui`'s. No reimplementation of
    `SearchField` (or any other primitive), no JSX visual language, no CSS classes, no
    inline styles, no tokens, no `styles.css`;
  - domain types (`Note[]`, `Todo`, `List`, `TodoFilters`): params are plain strings.

## Success Criteria

1. Every export in the Public API block exists with the declared signature and no extra
   public surface.
2. `filterHref` reproduces both current builders' outputs: preserved params, the overridden
   axis changed, emptied keys absent, and `path` alone when no params remain.
3. `parseTagId` matches `/^\d+$/ → Number` with `undefined` otherwise.
4. `PreservingSearchBox` is the only client module, composes `@life/ui`'s `SearchField`
   unchanged, and carries zero `fetch`/visual markup.
5. `loadOrNotFound` needs no import of `apps/app`'s `ApiError`; `routeLayoutMetadata` +
   `RouteLayout` shrink each segment layout to a metadata call and a default export.
6. `npm run typecheck -w packages/app-kit` is clean and `npm run test:unit -w packages/app-kit`
   is green; the root `--workspaces` scripts pick the package up.
7. `grep -rnE "Note|Todo|List\b" packages/app-kit/src` finds no domain identifiers; the
   frozen e2e selector surface and tokens are untouched.

## Open Questions

- None. The map fixes `app-kit`'s responsibilities and dependency direction; the signatures
  above are derived from the current duplicated implementations and are owned here.
