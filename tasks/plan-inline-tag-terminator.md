# Implementation Plan: inline-tag-terminator — a `#tag` is committed by a terminator (strict while typing, end-of-content when leaving)

Branch: `refactor/notes-todos-shared-ui` (`master` stays untouched until the user asks to
merge). Home service: `apps/app` (it owns the note composer / inline parser and the editor).

Process: global protocol §3 (testing), §5 (mandatory task template), §6 (plan validation
gate), §7 (review + five-lane gate). Every delegated task below is in §5 template form.
Test runs are targeted, named files only, max 2 executions; no full suite. **No agent ever
runs E2E** (the harness binds local ports, a hard line): the single §3-permitted browser run
is executed by the **human** at the end, and nothing is committed until that result is green.
Every task is reviewed under §7 (blast radius, contract, project contracts) before the next
dependent task starts. The five-lane gate is executed by five parallel subagent lanes, not a
shell command.

## Objective

Stop the notes autosave from creating registry rows for a partially typed `#token`, while
still committing a tag the user leaves at the very end of a note. The inline grammar gets
**two modes over one regex**:

- **Strict mode (the default; used by the 400 ms autosave).** A tag is recognized **only
  when its name run is followed by a terminator** (a character that is not a name character);
  **end-of-content is not a terminator**. This is what kills the orphan bug: a draft's
  trailing partial token never parses.
- **Final mode (used only when the user leaves the editor).** End-of-content **is** a
  terminator, so a trailing `#groceries` at the moment of leaving is committed.

The atomic registry side effect (`POST /api/tags` via `resolveInlineTagIds →
createOrGetTag`) becomes a consequence of a committed token during typing, and of an explicit
leave at the end. Success = `parseInlineTags` takes an options object
(`{ eofTerminates?: boolean }`, default `false`) implemented over the *same* single regex,
the editor threads the mode per trigger and closes the dirty-check hole (a leave with only a
trailing tag must still send), the four broken test assertions are rewritten with
mode-explicit real scenarios, and the documented grammar in `SPEC-notes-ui.md` is updated in
the same change.

## User request (Change 2 of a two-part request)

> The root cause is the autosave creating intermediate tags while the user is still typing
> a tag word. A `#token` should only become a tag once the user finishes it.

> what about the case where user ends a note or leaves a period?

Chosen: **Also commit the tag when the note is left** (over strict-only). So end-of-content
is not a terminator *while typing* (the fix) but **is** one when the editor is left (the
completion).

**Relationship to Change 1.** Change 1 (`cleanup-tags`, `tasks/plan-orphan-tag-cleanup.md`)
is a remediation tool for rows the bug already produced; it is already committed and must
not regress. Change 2 is the root-cause fix: strict mode removes the *trigger* that produces
evolving-token orphans. Detach orphans and failed-write orphans are inherent to
create-on-use and remain Change 1's job (lesson `0009`). Final mode deliberately reintroduces
one bounded, user-triggered exception (an abandoned trailing token commits on leaving); that
row is exactly what Change 1's GC collects.

## Scope

- **In:** the parser `apps/app/lib/inline-tags.ts`; the suite
  `apps/app/test/inline-tags.test.ts`; the editor `apps/app/app/note-editor.tsx` (thread the
  parse mode through the save/keepalive paths and close the dirty-check hole); the grammar
  documentation in `docs/specs/SPEC-notes-ui.md`.
- **Out:** `apps/app/lib/note-compose.ts`, `tags-compose.ts`, `flush-payload.ts` (the
  pipeline is unchanged — `readFlushPayload` is structural only and never re-parses);
  `apps/app/app/note-title.ts`; everything under `packages/**`; `apps/note-service/**`,
  `apps/todo-service/**`, `apps/tags-service/**`; `compose.yaml`; `.env*`; `apps/*/data/**`;
  **every e2e file, byte-identical** (the frozen e2e selector surface: roles, visible text,
  aria-labels, `button.trash-delete`); token values
  (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`); PWA constants
  (`public/manifest.json`, `viewport.themeColor`); `docs/specs/SPEC-todo-ui.md`; any new npm
  dependency.
- **Not engaged — Contract 2 (backend data layer).** No backend service, cache, or DB is
  touched; the parser is pure string logic with no I/O. No *Cache plan* applies.
- **Engaged — Contract 1 (shared UI).** `lib/inline-tags.ts` is app-specific behaviour glue
  (Contract 1 Rule 3 case 2) with no visual responsibility. `note-editor.tsx` already
  composes `@life/ui` primitives (`EditorChrome`, `Textarea`, `IconButton`, `Button`,
  `StatusText`, `AlertBanner`); the change adds **no markup, no class, no style, no token,
  no raw HTML** — only JS logic and comments. Primitive-reuse plan: not applicable, existing
  primitives are untouched, no visual language is introduced.

## Decision table

| # | Decision | Locked value |
|---|---|---|
| D1 | Fix location | `apps/app/lib/inline-tags.ts` regex + `parseInlineTags` signature; `apps/app/app/note-editor.tsx` mode threading. Pipeline modules untouched. |
| D2 | Strict grammar (exact, unchanged) | `const INLINE_TAG = /#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu;` |
| D3 | Name characters | Unicode letters `\p{L}`, digits `\p{N}`, `-`, `_` |
| D4 | Strict terminator | any character that is **not** a name character; **end-of-content is not a terminator** (positive lookahead, not negative — a negative lookahead would re-introduce the bug) |
| D5 | Rejected alternatives | enumerating separators; a second regex for final mode; making the whole parser EOF-tolerant (rejected in lesson `0009`) |
| D6 | Unchanged pipeline | `normalizeName` (`.trim().slice(0, TAG_NAME_MAX)`) and `dedupeTags` (case-insensitive, first-seen casing) byte-for-byte unchanged |
| D7 | Render-side parity | **No second `#`-parser exists** in code (investigated, see Context) → no parity task; `parseInlineTags` is the only parser |
| D8 | Spec-first | `SPEC-notes-ui.md:167-169` documents the inline grammar (old regex) → mandatory update (strict + final). `SPEC-todo-ui.md:31` — its claim is **still true** under final mode → **no edit** (see Context) |
| D9 | Suite | rename the `describe`, rewrite the 4 breaking assertions, seed mode-explicit real-scenario cases incl. the strict-only prefix-subset invariant |
| D10 | Pasted URL fragment | **accepted limitation**, documented in Deviations, not fixed |
| D11 | E2E journey spec | **Untouched, byte-identical.** With final mode the existing flow (type `#errand`, click Save = leave) should pass unmodified. The user-approved one-line test-data fix is kept only as a documented fallback (Deviations). The human-run E2E is the only end-to-end proof (no editor unit test). |
| D12 | Final mode (new) | `parseInlineTags(body, { eofTerminates?: boolean } = {})`, default `false` = strict. Final mode implemented by appending a whitespace terminator to the body before matching (`const source = eofTerminates ? body + ' ' : body;`), consumed by `source.matchAll(INLINE_TAG)` — **one regex, one function**. |
| D13 | Final-mode triggers | blur, Back, Save, `pagehide`, `visibilitychange → hidden`, conflict `keepMine`. Never the 400 ms debounce; `loadLatest` does not save (trigger map below). |
| D14 | Dirty-check hole | A final-mode save must send when the final parse yields names the strict parse did not, even if the body is clean. Closed in `save` and `flushKeepalive` before their `!dirtyRef` guards (exact anchors below). |
| D15 | Commit | explicit-path `git commit` only after the five lanes are N/N PASS **and** the human E2E is green; no `git add -A`, no push, no merge without the user's request. |

## Context

### Root cause (given, confirmed against the code)

`apps/app/lib/inline-tags.ts:11` is `const INLINE_TAG = /#([^\s#]+)/g`. It matches a
`#token` **regardless of what follows it**, so a token paused mid-typing (`#ho`) already
parses as a tag. Every 400 ms autosave flush re-parses the body
(`apps/app/app/note-editor.tsx:122` and `:238` → `parseInlineTags` → flush payload
`inlineTagNames` → `apps/app/lib/note-compose.ts:16-22` `writeTagIds` →
`apps/app/lib/tags-compose.ts:49` `createOrGetTag` → `POST /api/tags`) and creates the
registry row **before** the note write is attempted. Repeated autosaves of an *unchanged*
body are idempotent, so idle autosave never multiplied rows — only a changing token did
(`#ho`, then `#hom`, then `#home` → three rows, two orphaned). That is the bug lesson
`0009` records.

### Investigation: is there a second `#`-parser?

- **No second parser.** `apps/app/lib/inline-tags.ts:11` is the only `#`-regex in the
  repository. `apps/app/app/note-title.ts:1` (`splitBody`) only splits on newlines and does
  **not** parse tags. There is no chip/highlight renderer that re-parses `#` from the body —
  the editor is a plain `textarea`, and tag chips render from registry names/`tagIds`, never
  from body text. `grep` for `matchAll(/#`, `startsWith('#')`, `indexOf('#')`, `'#'`
  literals across `apps/**` and `packages/**` returns nothing beyond the one site.
- **Consequence:** no parse-side/render-side parity defect. D7 records this; no parity task.

### Investigation: does a spec document the inline grammar?

- **Yes — `docs/specs/SPEC-notes-ui.md:167-169`** states the grammar verbatim:
  "... tags are parsed from the body (`/#([^\s#]+)/g`, trimmed, deduped case-insensitively,
  max 50 chars each) ...". This is the grammar of record → a spec-first update task is
  **mandatory** (T1), and it now documents **two modes**.
- `docs/specs/SPEC-todo-ui.md:31-34` states "(frozen e2e behavior: typing `#errand` still
  creates the filter link)". **Re-checked under final mode:** the journey spec types
  `#errand` and then clicks **Save** (a leave path), so the tag is committed and the link
  appears — the claim remains true. Per the user's rule (do not edit a spec just to edit it),
  **`SPEC-todo-ui.md` is dropped from T1's scope**. The nuance (no link *while* typing, only
  after leaving) is recorded in Deviations rather than edited into the spec.
- `docs/specs/SPEC-tags-extraction.md` does **not** document the inline grammar (it covers
  the registry migration only) — checked in full.
- `docs/specs/MAP-shared-page-blocks.md:42-43` and `docs/specs/SPEC-app-kit.md:291` only
  *name* "inline `#tag` parsing" as app-specific behaviour; no grammar, no edit needed.

### Investigation: the editor, and whether the E2E still passes

Read `apps/app/app/note-editor.tsx` in full (421 lines). Facts:

- `save` and `flushKeepalive` are **two distinct functions with two distinct parse call
  sites** — `note-editor.tsx:122` and `:238`. Not four.
- `save` returns early when clean: `if (!dirtyRef.current) return true;` at `:93`;
  `flushKeepalive` returns early at `:269` (`if (inFlightRef.current || !dirtyRef.current ||
  !nextBody.trim()) return;`) and `:273` (`if (!dirtyRef.current) return;`). An autosave
  clears `dirtyRef` when it sends (`:110`, `:230`).
- So without D14, ordering "autosave-fires-first" persists `remember #groceries` with
  `inlineTagNames: []`, clears dirty, and the leave-path final flush sends **nothing** — the
  exact case the user asked to fix. D14 closes this.
- **`journey.suite.ts` is unchanged by this change and is the only end-to-end proof of final
  mode.** `editNote` (`apps/app/test/e2e/journey.ts:77-78`) does `textarea.fill(`${created}
  #errand`)` then clicks **Save** (`getByLabel('Save').click()` → `leave()`), which is a
  final-mode trigger. The 400 ms autosave race is reasoned through below; both orderings pass
  **only because D14 exists**.
- There is **no unit test** for `note-editor.tsx` (`grep` for `NoteEditor|note-editor` across
  `apps/app/test/**` returns nothing; no `*editor*` test file). Hence the human-run E2E is the
  only browser-level proof, and no E2E file is modified: the flow must keep working as-is.

### E2E race reasoning (why the untouched journey stays green)

`editNote` fills the body (dispatching `input` → `schedule()` starts the 400 ms timer) and
then clicks **Save** (→ `leave()` → `flush('final')`).

- **Ordering A — Save lands before 400 ms:** `flush` clears the timer (`:198-201`), so no
  strict autosave runs; `save('final')` starts a fresh drain and sends
  `parseInlineTags(body, { eofTerminates: true })` = `['errand']`. The link appears. PASS.
- **Ordering B — autosave fires first (likely: Playwright's `fill`→`click` round trip often
  exceeds 400 ms):** the strict `save()` PATCHes the body with `inlineTagNames: []`, clears
  `dirtyRef` (`:110`). Then Save → `flush('final')` → `save('final')`: `hasUncommittedTrailingTag(body)`
  is `true` because `#errand` sits at end-of-content, so it forces `dirtyRef.current = true`
  **before the `:93` guard** and (if a strict drain is still in flight) `modeRef.current =
  'final'` upgrades it. The drain sends `['errand']`. The link appears. PASS.
- **Without D14, ordering B fails** (`save('final')` returns `true` at `:93` with nothing
  sent). D14 is therefore mandatory, not defensive.

### Ground truth (file:line, read-only)

- `apps/app/lib/inline-tags.ts:11` — the regex; `:13-16` `normalizeName`; `:18-30`
  `dedupeTags`; `:32-39` `parseInlineTags` (uses `body.matchAll(INLINE_TAG)`).
- `apps/app/app/note-editor.tsx`: `save` `:87` (clean guard `:93`, dirty clear `:110`, parse
  `:122`, drain finally `:191-193`); `flush` `:197-203`; `leave` `:207-210`; `flushKeepalive`
  `:214` (nextBody `:219`, fail `:225`, send `:229`, parse `:238`, create guard `:269`,
  clean guard `:273`); `schedule` timer `:289-292`; `keepMine` `:319-330` (`save()` `:329`);
  `loadLatest` `:304`; `onBlur` `:417`; Back `:364`; Save `:367`; `pagehide` `:346`;
  `visibilitychange` `:349`.
- `apps/app/test/inline-tags.test.ts:4` describe title; breaking assertions at `:6`, `:14`,
  `:19`, `:25`; untouched at `:10`, `:29`, `:33`.
- `packages/shared/src/index.ts:50` — `TAG_NAME_MAX = 50`.
- `apps/app/tsconfig.json` target `ES2022`, `include` `**/*.ts` (tests typechecked);
  `tsconfig.test.json` used by ts-jest. `\p{…}` + `u` is supported by both.
- `apps/app/package.json`: `"typecheck": "tsc --noEmit"`,
  `"test:unit": "jest --passWithNoTests"` (verified). Both profile commands resolve as
  written below.
- E2E: `apps/app/playwright.config.ts:20` `testMatch: '**/*.spec.ts'`, `testDir:
  './test/e2e'`; the runnable spec is `apps/app/test/e2e/journey.prod.spec.ts` (imports
  `registerJourney` from `suites/journey.suite.ts`, which registers the `test(...)` calls at
  module load). Dev harness: `playwright.dev.config.ts` +
  `test/e2e/dev/journey.dev.spec.ts`. The journey test's registered name is
  `create → edit → tag → search → reload keeps session → trash → restore → permanent delete`.

## Requirements

### Grammar (exact)

The parser constant is unchanged:

```ts
const INLINE_TAG = /#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu;
```

- `u` is **mandatory** for `\p{L}`/`\p{N}`; `g` is required by `body.matchAll`.
- The lookahead is **positive** (`(?=[^…])`), so a match requires an actual following
  character. A negative lookahead (`(?![…])`) would also succeed at end-of-string and would
  **re-introduce the bug** — forbidden.
- Inside the class, `-` is last, hence literal; `_` is explicit. No separator enumeration.

### Derived consequences — strict mode (`eofTerminates: false`, the default)

| Input | Result | Why |
|---|---|---|
| `#home,` | `home` | `,` is not a name char |
| `#home.` | `home` | `.` is not a name char |
| `#home` at end of text | **no tag** | no following char → lookahead fails (**the fix**) |
| `#to-do list ` | `to-do` | `-` is a name char; space terminates |
| `#my_tag ` | `my_tag` | `_` is a name char; space terminates |
| `#1.5 hours` | `1` | `.` terminates right after `1` |
| `#e.g.` | `e` | `.` terminates right after `e` |
| `#c++` | `c` | `+` is not a name char |
| `#work/home` | `work` | `/` is not a name char |
| `#nhóm_chính ` | `nhóm_chính` | `ó`,`í` are `\p{L}`; `_` is a name char |
| `## Heading ` | none | both `#` are followed by a non-name char |
| `# ` (bare) | none | `#` followed by space |

### Derived consequences — final mode (`eofTerminates: true`)

Final mode = strict plus the trailing name run. **final ⊇ strict always.**

| Input (body ending) | strict | final | Why |
|---|---|---|---|
| `remember #groceries` | `[]` | `['groceries']` | end-of-content is a terminator only in final mode |
| `#home.` | `['home']` | `['home']` | `.` terminates in both; final never changes an already-terminated tag |
| `#` at end | `[]` | `[]` | a bare `#` has no name run |
| `#ho` at end | `[]` | `['ho']` | **accepted cost:** a token abandoned at the moment of leaving commits; Change 1's GC collects it |

`TAG_NAME_MAX` truncation and case-insensitive dedupe keep working unchanged (the pipeline
after the regex is untouched). Consequence: `#<75 x's>` at end yields `[]` (strict) /
`['x'.repeat(TAG_NAME_MAX)]` (final); `#<75 x's> ` yields the truncated name in both.

### Final-mode implementation (one regex, one function)

```ts
export interface ParseInlineTagsOptions { eofTerminates?: boolean }

export function parseInlineTags(
  body: string,
  { eofTerminates = false }: ParseInlineTagsOptions = {},
): string[] {
  // Final mode appends a whitespace terminator, which is exactly equivalent to treating
  // end-of-content as a terminator: the appended space is a non-name character sitting
  // where the string ended, so it can only terminate a trailing name run and can never
  // create a new match. Strict mode is byte-identical to the old call.
  // ponytail: if the two modes ever diverge, swap the appended space for a dedicated
  // `(?=[^\p{L}\p{N}_-]|$)` boundary regex instead of string surgery.
  const source = eofTerminates ? body + ' ' : body;
  const names: string[] = [];
  for (const match of source.matchAll(INLINE_TAG)) {
    const name = normalizeName(match[1]);
    if (name) names.push(name);
  }
  return dedupeTags(names);
}
```

**Do not ship a second regex.** The single already-verified `INLINE_TAG` is reused, so every
strict-mode consequence row above carries over unchanged, and final mode is strict plus one
possible trailing name.

### Report / behaviour contract

`parseInlineTags(body: string, options?: ParseInlineTagsOptions): string[]`:

- Returns the names of recognized tokens, **in body order**, after `normalizeName`
  (`.trim().slice(0, TAG_NAME_MAX)`, empty → dropped) and `dedupeTags` (case-insensitive,
  first-seen casing). No duplicates, no blanks, no `#` in any returned name.
- Default (`eofTerminates` falsy) is strict: a token is recognized **iff** its name run is
  followed by a character not in `[\p{L}\p{N}_-]`; end-of-content is not a terminator.
- `eofTerminates: true` is final: end-of-content is also a terminator.
- The returned alphabet, ordering, truncation and dedupe are identical across modes; only
  the set of recognized tokens differs (final adds at most the trailing name run).
- `dedupeTags` is exported unchanged. A second exported helper,
  `hasUncommittedTrailingTag(body: string): boolean`, returns
  `parseInlineTags(body, { eofTerminates: true }).some((name) => !parseInlineTags(body).includes(name))`
  — true iff a final save would carry a name a strict save did not. It is the D14 predicate.

### Trigger map (strict vs final)

| Trigger | Site | Mode |
|---|---|---|
| 400 ms autosave timer → `save()` | `note-editor.tsx:289-292` (→ parse `:122`) | **strict** |
| `onBlur` → `flush()` | `:417` → `:197-203` (→ parse `:122`) | **final** |
| Back (`:364`) / Save (`:367`) → `leave()` → `flush()` | `:207-210` → `:197` | **final** |
| `flushKeepalive` on `pagehide` / `visibilitychange → hidden` | `:346`, `:349` (→ parse `:238`) | **final** |
| conflict `keepMine()` → `save()` | `:319-330` (`:329`) | **final** (explicit user action) |
| conflict `loadLatest()` | `:304` | none (does not save) |

`save` and `flushKeepalive` are the **two** parse call sites (`:122`, `:238`); both must
carry the mode. `flush` and `leave` thread a mode parameter down to `save`; the debounce
timer calls `save` with no argument (strict default).

### The dirty-check hole and its closure (D14)

`save` returns early at `:93` and `flushKeepalive` at `:269`/`:273`; the autosave clears
`dirtyRef` when it sends (`:110`/`:230`). So a clean-body final flush sends nothing, and a
trailing tag is never created. Closure (exact anchors):

1. **`save` (new `mode: 'strict' | 'final' = 'strict'` param).** At the very top, *before*
   `const running = drainRef.current;` (`:88`), when `mode === 'final'`:
   set `modeRef.current = 'final'` and, if `hasUncommittedTrailingTag(bodyRef.current)`, set
   `dirtyRef.current = true`. This runs before the `:93` guard whether we start a new drain or
   join one that is already in flight.
2. **Inside the drain loop** the payload parse at `:122` reads
   `parseInlineTags(nextBody, { eofTerminates: modeRef.current === 'final' })` **fresh each
   iteration**, so a final request that coalesces into an in-flight strict drain upgrades the
   re-issued request (the shared `drainRef` at `:88-89` would otherwise keep the strict
   closure).
3. **Reset `modeRef.current = 'strict'` in the drain's `.finally`** (`:191-193`) so final
   mode is not sticky across a later blur/refocus.
4. **`flush` (new `mode` param, default `'strict'`)** passes `save(mode)` at `:202`.
   `leave` calls `flush('final')` at `:208`; `onBlur` calls `flush('final')` at `:417`; the
   debounce timer keeps `save()` at `:291`; `keepMine` calls `save('final')` at `:329`.
5. **`flushKeepalive(allowCreate, mode)`:** after `const nextTagIds = selectedRef.current;`
   (`:220`) and **before** the guards at `:269`/`:273`, add
   `if (mode === 'final' && hasUncommittedTrailingTag(nextBody)) dirtyRef.current = true;`.
   The parse at `:238` becomes
   `parseInlineTags(nextBody, { eofTerminates: mode === 'final' })`. Callers at `:346`/`:349`
   pass `'final'`.
6. **Failure and no-loop.** On a failed final request the existing behavior is preserved —
   `dirtyRef.current = true`, `setStatus('error')`, `save` returns `false`, `leave` does not
   navigate (`:147-149`, `:178-182`; `flushKeepalive`'s `fail()` at `:225-228`). The forcing
   runs **once at `save` entry**, not once per loop iteration; the send clears `dirtyRef` at
   `:110`, so the loop's next `:93` check exits. No re-force → no spin.

### File structure

Modify:

- `apps/app/lib/inline-tags.ts` (T2) — regex unchanged; `parseInlineTags` gains the options
  object + `eofTerminates` final mode; add and export `hasUncommittedTrailingTag`;
  `ParseInlineTagsOptions`; update the doc comment.
- `apps/app/test/inline-tags.test.ts` (T2) — rename `describe`, rewrite the 4 breaking
  assertions, add mode-explicit scenario cases (full list under *Test-case list*).
- `apps/app/app/note-editor.tsx` (T3) — thread `mode`; add `type ParseMode` and
  `modeRef`; force dirty for final saves; final parse at `:122`/`:238`; update the module doc
  comment at `:39-45`.
- `docs/specs/SPEC-notes-ui.md` (T1) — the `### Editor` → **Tags** bullet (lines 167-169):
  state the strict grammar + the final-mode leave rule, with the exact regex.

Not modified: `docs/specs/SPEC-todo-ui.md`; `apps/app/lib/note-compose.ts`,
`tags-compose.ts`, `flush-payload.ts`; `apps/app/app/note-title.ts`; every `packages/**`; all
services; **every e2e file**; `apps/*/data/**`; frozen token/PWA surfaces.

## Task List

### Phase 1 — Spec-first (grammar of record)
- [ ] T1: update the inline grammar in `SPEC-notes-ui.md` (strict + final).

### Checkpoint: Spec
- [ ] `SPEC-notes-ui.md` states the exact regex, the strict end-of-content rule, and the
      final-mode leave rule; `SPEC-todo-ui.md` is byte-unchanged; no pre-existing line outside
      the Tags bullet changed.

### Phase 2 — Parser + suite (TDD)
- [ ] T2: write the mode-explicit suite first (red), add the options object + final mode
      (green), refactor with the suite green.

### Checkpoint: Parser
- [ ] `npm run typecheck` in `apps/app` exits 0.
- [ ] `npm run test:unit -- test/inline-tags.test.ts` in `apps/app` green.
- [ ] `apps/app/lib/inline-tags.ts` contains exactly the D2 regex (one regex);
      `normalizeName`/`dedupeTags` bodies unchanged.

### Phase 3 — Editor integration (final mode + dirty-hole closure)
- [ ] T3: thread the parse mode through `save`/`flush`/`leave`/`keepMine`/`flushKeepalive`
      and close the dirty-check hole.

### Checkpoint: Editor
- [ ] `npm run typecheck` in `apps/app` exits 0 (the only local gate; no editor unit test
      exists).
- [ ] The trigger map is implemented exactly; `hasUncommittedTrailingTag` gates both
      `save('final')` and `flushKeepalive('final')` before their clean guards.

### Phase 4 — Verification gate + commit
- [ ] T4: suite gate, Contract-1 checks, frozen-surface check, five-lane verification.
- [ ] Hand the single E2E command to the human; commit only on a green result.

### Checkpoint: Complete
- [ ] All acceptance criteria met; five lanes N/N PASS; the human-run E2E green; `master`
      untouched; merge awaits the user's explicit request.

## Delegation plan (tasks in §5 template form)

### T1 — inline grammar spec update (module `inline-tag-terminator-spec`)

[TASK OBJECTIVE]
  Record the strict + final inline `#tag` grammar in `SPEC-notes-ui.md` before any code, so
  the parser and editor implement a documented contract.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `docs/specs/SPEC-notes-ui.md` (the `### Editor` Tags bullet,
    lines 167-169). No other section is rewritten.
  - Reference files (read-only): `apps/app/lib/inline-tags.ts`,
    `apps/app/app/note-editor.tsx`, `apps/app/test/inline-tags.test.ts`,
    `docs/specs/SPEC-tags-extraction.md`, `docs/specs/SPEC-todo-ui.md`,
    `docs/specs/MAP-shared-page-blocks.md`, `docs/specs/SPEC-app-kit.md`, `docs/lessons/`.
  - Strictly prohibited files: every file not listed above — in particular any
    `apps/**`/`packages/**` source or test, `docs/specs/SPEC-todo-ui.md`, any `apps/*/data/**`,
    the Project Profile table, and the frozen e2e/token/PWA surfaces.

[IMPLEMENTATION REQUIREMENTS]
  - In the `SPEC-notes-ui.md` Tags bullet, state in place:
    1. a tag NAME is a run of Unicode letters/digits/`-`/`_`;
    2. **strict** (the autosave parse): a `#token` is recognized **only** when followed by a
       character that is not a name character, and **end-of-content is not a terminator** — a
       partial token never becomes a tag while typing;
    3. **final** (when the editor is left: blur, Back/Save, or the page being hidden):
       end-of-content **is** a terminator, so a tag left at the very end of the note is
       committed;
    4. the exact grammar, written verbatim:
       `/#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu`, still trimmed, deduped
       case-insensitively, max 50 chars each, used by **one** parser for both modes.
  - Keep the surrounding text untouched; no placeholder/TODO wording.
  - Do **not** touch `SPEC-todo-ui.md` (its frozen-e2e claim remains true under final mode —
    see the plan Context), `SPEC-tags-extraction.md` (no grammar there), or the two behaviour
    references (`MAP-shared-page-blocks.md`, `SPEC-app-kit.md`).

[VERIFICATION & TESTING RULES]
  - No test command: documentation-only task (global §3 — docs changes take no test; **NO
    E2E**).
  - Permitted read-only checks (max-test-runs: 2): `grep -n "p{L}" docs/specs/SPEC-notes-ui.md`
    (the exact regex present) and the Tech Lead reads the bullet back confirming the strict +
    final rules and that no pre-existing line changed.
  - Strict constraints: no code, no test, no `apps/*/data/**`, no Project Profile edit, no
    `SPEC-todo-ui.md` edit.

[DEFINITION OF DONE]
  - [ ] `SPEC-notes-ui.md` documents the D2 regex, the strict end-of-content rule, and the
        final-mode leave rule verbatim.
  - [ ] `SPEC-todo-ui.md` is byte-unchanged.
  - [ ] No file outside the allowed scope was modified; no other section rewritten.

---

### T2 — dual-mode terminator parser + scenario suite (module `inline-tag-terminator`)

[TASK OBJECTIVE]
  Add the `{ eofTerminates }` options object over the existing single strict regex, add the
  `hasUncommittedTrailingTag` predicate, and rewrite/expand `apps/app/test/inline-tags.test.ts`
  with mode-explicit real user scenarios that prove the bug is fixed and final mode commits
  a trailing tag.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/lib/inline-tags.ts` (regex unchanged; options
    object + helper + doc comment), `apps/app/test/inline-tags.test.ts`.
  - Reference files (read-only): `apps/app/app/note-editor.tsx` (the two parse call sites — do
    **not** edit), `apps/app/lib/note-compose.ts`, `apps/app/lib/tags-compose.ts`,
    `apps/app/lib/flush-payload.ts`, `packages/shared/src/index.ts`,
    `docs/specs/SPEC-notes-ui.md`, `docs/lessons/0009-autosave-inline-tag-orphans.md`.
  - Strictly prohibited files: every file not listed above — in particular
    `apps/app/app/note-editor.tsx`, `apps/app/app/note-title.ts`, all `packages/**`, all
    services, all `apps/app/test/e2e/**`, any `apps/*/data/**`, the frozen token/PWA
    surfaces, and any new dependency.

[IMPLEMENTATION REQUIREMENTS]
  - **One regex, one function.** Keep `const INLINE_TAG = /#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu;`.
    Add `export interface ParseInlineTagsOptions { eofTerminates?: boolean }` and change the
    signature to `parseInlineTags(body: string, options?: ParseInlineTagsOptions): string[]`.
    Final mode is implemented **exactly** as the plan's *Final-mode implementation* section
    states — a `source` constant (`eofTerminates ? body + ' ' : body`) consumed by
    `source.matchAll(INLINE_TAG)` — with the equivalence comment and the `ponytail:` upgrade-path
    comment (`(?=[^\p{L}\p{N}_-]|$)`) from that same section.
  - **Forbidden forms:** a second regex; a negative lookahead (`(?![…])`); a `(?=$)` boundary
    regex as the shipped implementation; a `\s`-only terminator; separator enumeration; the
    `v` flag; trimming before parsing.
  - **Helper.** Add `export function hasUncommittedTrailingTag(body: string): boolean` with
    the exact body from the plan's *Report / behaviour contract* section.
  - **Unchanged pipeline.** Do **not** change `normalizeName` or `dedupeTags` (D6); do not
    change `parseInlineTags`'s dedupe/normalize behavior, only the source it scans.
  - **Primitive reuse plan (Contract 1):** not applicable — `lib/inline-tags.ts` is
    app-specific behaviour glue (Rule 3 case 2); no `@life/ui` primitive, token, JSX, CSS,
    `className`, or inline `style` is involved.
  - **Suite.** Rename the describe to
    `parseInlineTags (#tag is committed by a terminator; end-of-content only when leaving)`.
    Every `it(...)` title must name the user situation. Implement every case in the
    *Test-case list* with its stated mode; do not add per-character separator loops or assert
    the same input twice for the same mode.
  - **TDD order.** Write the suite first and run it red against the old parser, then add the
    options object to green, then refactor with the suite green.

[VERIFICATION & TESTING RULES]
  - Permitted test commands (max test executions: 2): `npm run typecheck` (in `apps/app`) and
    `npm run test:unit -- test/inline-tags.test.ts` (in `apps/app`).
  - No full suite; **NO E2E** (the only browser run is the human handover in T4; global §3 +
    the local-ports hard line).
  - Strict constraints: no `packages/**`/service/e2e/data edit; no dependency change;
    `normalizeName`/`dedupeTags` byte-unchanged; only one `INLINE_TAG` regex in the file.

[DEFINITION OF DONE]
  - [ ] `apps/app/lib/inline-tags.ts` has exactly one regex; `parseInlineTags` accepts the
        options object; `hasUncommittedTrailingTag` is exported; `normalizeName`/`dedupeTags`
        unchanged.
  - [ ] `apps/app/test/inline-tags.test.ts` is renamed, the 4 breaking assertions are
        rewritten, and every case in the *Test-case list* passes.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck` in `apps/app` passes with zero errors.
  - [ ] `npm run test:unit -- test/inline-tags.test.ts` in `apps/app` passes.

---

### T3 — editor final-mode wiring + dirty-hole closure (module `inline-tag-terminator-editor`)

[TASK OBJECTIVE]
  Thread the parse mode through the editor's save/keepalive paths per the trigger map and
  close the dirty-check hole so leaving with a trailing tag always commits it.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: `apps/app/app/note-editor.tsx`.
  - Reference files (read-only): `apps/app/lib/inline-tags.ts`,
    `apps/app/lib/note-compose.ts`, `apps/app/lib/flush-payload.ts`,
    `docs/specs/SPEC-notes-ui.md`, this plan.
  - Strictly prohibited files: every file not listed above — in particular
    `apps/app/lib/inline-tags.ts` and `apps/app/test/inline-tags.test.ts` (T2's scope), all
    `packages/**`, all services, all `apps/app/test/e2e/**`, any `apps/*/data/**`, the frozen
    token/PWA surfaces.

[IMPLEMENTATION REQUIREMENTS]
  - **Type + ref.** Add `type ParseMode = 'strict' | 'final';` and
    `const modeRef = useRef<ParseMode>('strict');`.
  - **`save(mode: ParseMode = 'strict')`** — at the very top, **before** `const running =
    drainRef.current;` (`:88`): when `mode === 'final'`, set `modeRef.current = 'final'` and,
    if `hasUncommittedTrailingTag(bodyRef.current)`, set `dirtyRef.current = true`.
  - **Payload parse `:122`** becomes
    `parseInlineTags(nextBody, { eofTerminates: modeRef.current === 'final' })`, read fresh
    each drain-loop iteration.
  - **Reset `modeRef.current = 'strict'` in the drain `.finally`** (`:191-193`) so final mode
    is not sticky.
  - **`flush(mode: ParseMode = 'strict')`** passes `save(mode)` at `:202`; `leave` calls
    `flush('final')` at `:208`; `onBlur` calls `flush('final')` at `:417`; the debounce timer
    keeps `save()` at `:291`; `keepMine` calls `save('final')` at `:329`.
  - **`flushKeepalive(allowCreate, mode)`** — after `:220`, before the `:269`/`:273` guards:
    `if (mode === 'final' && hasUncommittedTrailingTag(nextBody)) dirtyRef.current = true;`.
    Parse `:238` becomes `parseInlineTags(nextBody, { eofTerminates: mode === 'final' })`;
    callers `:346`/`:349` pass `'final'`.
  - **Failure mode unchanged:** a failed final request keeps the body dirty, sets
    `setStatus('error')`, returns `false`, and `leave` does not navigate. The forcing runs
    once per `save` call (not per loop iteration); the send clears `dirtyRef`, so there is no
    loop.
  - **No second parse path:** the only two `parseInlineTags` call sites remain `:122` and
    `:238`; do not add a third and do not parse in the render body.
  - **Primitive reuse plan (Contract 1):** no markup change — `note-editor.tsx` already
    composes `@life/ui` (`EditorChrome`, `Textarea`, `IconButton`, `Button`, `StatusText`,
    `AlertBanner`); this task changes only JS logic and the doc comment at `:39-45`, and adds
    no raw HTML, class, inline style, token, or CSS.

[VERIFICATION & TESTING RULES]
  - Permitted command: `npm run typecheck` (in `apps/app`) — the only local gate (no editor
    unit test exists; see Context). Max test executions: 2.
  - **NO E2E executed by the agent.** The editor's behavior is proven end-to-end only by the
    human-run journey in T4 (local ports are a hard line).
  - Strict constraints: `apps/app/app/note-editor.tsx` only; no `packages/**`/service/e2e/data
    edit; no dependency change; existing `@life/ui` primitives untouched.

[DEFINITION OF DONE]
  - [ ] The trigger map is implemented exactly (strict: debounce; final: blur, Back/Save,
        pagehide/visibility-hidden, `keepMine`; `loadLatest` unchanged).
  - [ ] `save('final')` and `flushKeepalive('final')` force `dirtyRef` via
        `hasUncommittedTrailingTag` before their clean guards; `modeRef` resets in the drain
        `.finally`.
  - [ ] Only the two existing `parseInlineTags` call sites remain; no new markup/CSS/token.
  - [ ] No files outside the allowed scope were modified.
  - [ ] `npm run typecheck` in `apps/app` passes with zero errors.

---

### T4 — verification gate, E2E handover, and commit (module `inline-tag-terminator-verify`)

[TASK OBJECTIVE]
  Run the integrated suite gate and mechanical checks, close with the five-lane gate at N/N
  PASS, hand the single human E2E run over, and commit only on a green result.

[SCOPE & REPOSITORY CONTEXT]
  - Allowed files to edit/create: NONE (verification is read-only; any fix re-enters T1/T2/T3
    scope). The single allowed write is the explicit-path `git commit` in step 6 below.
  - Reference files (read-only): this plan, the T1 spec bullet, the T2/T3 diffs, the repo
    `AGENTS.md` (Project Profile + Contract 1), `~/.config/opencode/AGENTS.md`,
    `apps/app/playwright.config.ts`, `apps/app/test/e2e/journey.prod.spec.ts`.
  - Strictly prohibited files: everything (no edits); no `git add -A`; no push; no merge.

[IMPLEMENTATION REQUIREMENTS]
  1. Run, in `apps/app`: `npm run typecheck` and
     `npm run test:unit -- test/inline-tags.test.ts` (max-test-runs: 2; **NO E2E**).
  2. Run the Contract 1 mechanical checks listed in the *Verification gate* section; record
     each result.
  3. Confirm the frozen surfaces are **byte-unchanged**:
     `git status --porcelain apps/app/test/e2e packages/ui/test/tokens.test.ts
     docs/specs/SPEC-ui-tokens.md docs/specs/SPEC-todo-ui.md apps/app/public/manifest.json`
     is empty.
  4. Dispatch the five lanes in parallel, fail-closed: correctness/domain, code quality,
     security, QA (runs the suite gate), plan conformance (diff vs this plan + the T1 spec
     bullet). Any lane FAIL → fix its blockers in T1/T2/T3 → re-run only the failed lanes →
     repeat until N/N PASS.
  5. **E2E handover — never run Playwright.** Once the gate is green, hand the human the exact
     command and stop:
     `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "create → edit → tag → search → reload keeps session → trash → restore → permanent delete"`
     (run from the repo root; the registered test lives in `journey.prod.spec.ts`, which
     matches `testMatch: '**/*.spec.ts'`). Dev alternative:
     `npx playwright test --config apps/app/playwright.dev.config.ts apps/app/test/e2e/dev/journey.dev.spec.ts -g "create → edit → tag → search → reload keeps session → trash → restore → permanent delete"`.
     If it fails, diagnose from the pasted output, fix under T1/T2/T3 scope, and hand over
     again (single §3 re-run).
  6. **Commit — only after BOTH the five lanes are N/N PASS and the human E2E is green.**
     Stage explicit paths only:
     `git add apps/app/lib/inline-tags.ts apps/app/test/inline-tags.test.ts apps/app/app/note-editor.tsx docs/specs/SPEC-notes-ui.md tasks/plan-inline-tag-terminator.md`
     then `git commit -m "fix(notes): commit inline #tag on a terminator, not end-of-content"`.
     Never `git add -A`, never `git push`, never merge (merge only on the user's explicit
     request). Every other file stays unstaged.

[VERIFICATION & TESTING RULES]
  - Permitted commands only: the two profile commands above plus the read-only greps in the
    *Verification gate* section (max-test-runs: 2). No full suite, no other workspace. **NO
    E2E executed by an agent**: the single authorized browser run is handed to the human (see
    step 5) and is never launched here.
  - Strict constraints: no source/spec/test writes; no `apps/*/data/**` access.

[DEFINITION OF DONE]
  - [ ] Both profile commands pass in `apps/app`.
  - [ ] Every Project-Profile / Contract-1 check passes with the expected result.
  - [ ] Frozen surfaces (all e2e files, `SPEC-todo-ui.md`, tokens, PWA) are byte-unchanged.
  - [ ] The targeted E2E command has been handed to the human and a green result was pasted
        back — no agent invoked Playwright.
  - [ ] Five-lane verification returns N/N PASS; no partial verdict is accepted.
  - [ ] The commit exists with the exact staged paths and message above; `master` untouched
        and nothing pushed.

## Test-case list

Target file: `apps/app/test/inline-tags.test.ts` — `describe('parseInlineTags (#tag is
committed by a terminator; end-of-content only when leaving)')`. Every case states its mode
(`strict` = default, `final` = `{ eofTerminates: true }`). Baseline cases that still pass are
**kept**; the four that break are **rewritten**; scenario cases are **new**. Overlaps are
merged (see Deviations).

**Kept, unchanged (3):**

- K1 `dedupeTags trims and drops blanks` (was `:33`) — `dedupeTags([' a ', '', 'b', 'A'])`
  → `['a','b']` (helper; no mode).
- K2 `parseInlineTags returns no tags for a body without hashes` (was `:29`) — strict
  `'plain text'` → `[]`.
- K3 `dedupes case-insensitively, keeping first-seen casing` (was `:10`) — strict
  `'#Work do thing #work #WORK'` → `['Work']` (the trailing `#WORK` is un-terminated and not
  matched in strict; final also yields `['Work']` after dedupe — assert strict).

**Rewritten (4 — these currently assert the old grammar; all run in strict mode):**

- R1 (was `:6`) → `it('splits a line of finished tags into both names')`: strict
  `'buy milk #errand #home '` → `['errand','home']`.
- R2 (was `:14`) → `it('ignores a bare # and keeps only a terminated word')`: strict
  `'# #   #real '` → `['real']` (bare `'# '` → `[]` is folded into S12).
- R3 (was `:19`) → `it('truncates a terminated tag name to TAG_NAME_MAX')`: strict
  `'#' + 'x'.repeat(TAG_NAME_MAX + 25) + ' '` → `['x'.repeat(TAG_NAME_MAX)]`.
- R4 (was `:25`) → `it('treats punctuation as a terminator, not part of the name')`: strict
  `'see(#one),then #two!'` → `['one','two']`.

**New scenario cases (13; titles name the user situation and state the mode):**

- S1 (absorbs old S2) `typing "#ho" and pausing mid-word creates no tag — strict autosave
  ignores it, final save commits it`: strict `'buy milk #ho'` → `[]`; final `'buy milk #ho'`
  → `['ho']`; then finishing, `'buy milk #home '` → `['home']` in both — and `'ho'` never
  appears in the finished result.
- S3 `a note ending on "#home" carries no tag while typing but commits when you leave`:
  strict `'#home'` → `[]`; final `'#home'` → `['home']` (replaces the old "declared tradeoff"
  framing; S8's backspace case is this same mode pair).
- S4 `leaving never changes an already-terminated tag` — `'Call mom #home.'` → `['home']` in
  **both** strict and final.
- S5 `a real shopping list: comma and period commit each item` — `'Buy #eggs, then #milk.'` →
  `['eggs','milk']` (both modes; no trailing token).
- S6 `a parenthesised tag is committed by the closing paren` — strict `'(#grocery) list '` →
  `['grocery']`.
- S7 `a multi-line note: a newline commits the tag on line 1` — strict `'#errand\ncall back'`
  → `['errand']`.
- S9 `a Vietnamese tag name is parsed whole, not split` — strict `'#nhóm_chính '` →
  `['nhóm_chính']`.
- S10 `a hyphenated or underscored tag name stays intact` — strict `'#to-do list '` →
  `['to-do']` and `'#my_tag '` → `['my_tag']`.
- S11 `punctuation splits the name: decimals and operators are not part of it` — strict
  `'#1.5 hours'` → `['1']` and `'#c++ tips '` → `['c']`.
- S12 `markdown headings and a bare # are never tags` — strict `'## Heading '` → `[]` and
  `'text # '` → `[]`.
- S14 `typing forward never leaves a tag the finished text does not have (strict-mode
  prefix-subset invariant — the autosave path; final mode is never invoked per-keystroke)` —
  for each of `'Buy #eggs, then #milk.'` and `'Call mom #home and #work #errand.'`, compute
  `final = new Set(parseInlineTags(full))` (strict) and assert that for every prefix
  `full.slice(0, i)`, every name in `parseInlineTags(prefix)` (strict) is in `final`.
- S15 `pasting a URL with a fragment still yields the fragment word (documented
  limitation)` — strict `'https://example.com/page#section '` → `['section']`.
- S16 `hasUncommittedTrailingTag detects the trailing tag that forces a final save (the
  dirty-hole predicate)` — `'buy milk #ho'` → `true`; `'buy milk #home '` → `false`;
  `'#home'` → `true`; `'plain text'` → `false`.

Merged/dropped, with reasons (also in Deviations): old S2 folded into S1 (same input, must
not be asserted twice for one mode); old S8 folded into S3 (same mode pair); old S13 folded
into R3 (same truncation assertion). No case was dropped as "not meaningful".

## Dependency order and parallelization

```
T1 (spec) ──▶ T2 (parser + suite, TDD) ──▶ T3 (editor wiring) ──▶ T4 (verification gate + commit)
```

- T1 is spec-first: it fixes the strict + final grammar of record T2 implements against.
- T2 is a cohesion unit: the options object, the helper, and the suite ship together so the
  red → green loop runs against the real contract. It is the only unit-testable part.
- T3 depends on T2's `parseInlineTags(body, { eofTerminates })` and
  `hasUncommittedTrailingTag` exports; the editor has no unit test, so it is gated by
  typecheck here and by the human E2E in T4.
- T4 is last: read-only verification, then the human E2E handover, then the commit.

## Deviations / risks

- **D11 — the E2E journey spec stays byte-identical.** With final mode, the existing
  `journey.suite.ts` flow — `editNote` fills `${created} #errand` (unterminated) then clicks
  **Save** (a leave path) — commits `errand` and the filter-link assertion passes without any
  edit. The user's earlier approval of a one-line test-data fix
  (`` await editNote(page, created, `${tagged} `) ``) remains the **pre-approved fallback** if
  the human-run E2E comes back red, but it is **not applied** by this plan. The untouched
  spec is now the only end-to-end proof of final mode: `note-editor.tsx` has no unit test
  (verified — no `NoteEditor`/`note-editor` reference under `apps/app/test/**`).
- **Final-mode accepted cost (documented, not a bug).** An *abandoned* trailing token
  commits when the user leaves: blur with `#ho` at end-of-content → `['ho']` → one registry
  row. This is bounded and user-triggered (one token per leave, not one per keystroke), and
  it is exactly what Change 1's `cleanup-tags` GC collects. It is the price of the user's
  locked "commit when the note is left" choice.
- **`SPEC-todo-ui.md:31` deliberately not edited.** Its claim "(frozen e2e behavior: typing
  `#errand` still creates the filter link)" is true under final mode because the journey
  types then leaves. The nuance — no link *while* typing, only after leaving — is recorded
  here rather than edited into the spec (do not edit a spec just to edit it).
- **D10 — a pasted URL fragment is accepted, not fixed.** `https://example.com/page#section `
  yields `section`. Under strict mode this is a *stable, idempotent* false positive (the token
  is terminated, so it never multiplies and cannot orphan), not the evolving-token bug; strict
  mode already removes the URL's intermediate fragments (`#sec`, `#sectio`). Fixing the
  residual would require a **start-boundary** rule (the `#` must be preceded by
  start-of-content or a non-name character), which is a second, orthogonal grammar rule beyond
  the locked decision, with no user report behind it. Recorded as accepted; the start-boundary
  rule is the documented upgrade path if it ever bites.
- **`#` start-boundary is deliberately unchanged.** `foo#bar ` still parses `bar`; the fix
  only constrains what may *follow* a name. Out of scope; not a regression of asserted
  behaviour.
- **Mode threading through a shared drain.** The user's D14 sketch threads a mode parameter
  into `save`; because `save` coalesces concurrent calls through a shared `drainRef`
  (`:88-89`), the mode is additionally carried in `modeRef` so a final request that joins an
  in-flight strict drain still upgrades the re-issued request. The forcing is placed at
  `save` **entry** (not inside the drain loop) precisely so a forced-dirty send cannot spin
  the `for(;;)` loop on a permanent strict/final parse difference. This is the "cleaner
  place" A2 anticipated; it is required for the ordering-B E2E race.
- **Grammar spec home.** `SPEC-tags-extraction.md` does not document the inline grammar (it
  covers the registry migration). The grammar of record is `SPEC-notes-ui.md:167-169`; that
  is where T1 edits.
- **Merged/dropped cases.** Old S2 → S1; old S8 → S3; old S13 → R3 (see *Test-case list*).
  No scenario case was dropped as meaningless.
- **No second parser / no parity task.** Investigated (Context); D7.
- Any further implementation departure from this plan is recorded here with its rationale
  before the dependent task proceeds.

## Open Questions

- **None open.** The user's new locked decision (commit on leaving) is encoded in D12-D14 and
  the trigger map. The E2E journey is expected to pass untouched (world unchanged by the
  human-approved fallback if it does not); everything else is fixed by the locked decisions,
  the investigated sources (no second `#`-parser; grammar of record `SPEC-notes-ui.md:167-169`;
  no editor unit test) and the Project Profile.

## Verification gate

Run at the end of T3, before the five-lane gate; every command resolves from the repo Project
Profile. All greps exclude `apps/*/data/**`, `.next/**` and `dist/**`.

1. **Project Profile commands (in `apps/app`, max 2 executions; no agent runs E2E):**
   - `npm run typecheck` → exit 0.
   - `npm run test:unit -- test/inline-tags.test.ts` → green.
2. **Grammar check (read-only):**
   - `grep -n "const INLINE_TAG" apps/app/lib/inline-tags.ts` → exactly
     `/#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu`; `grep -c "const INLINE_TAG" apps/app/lib/inline-tags.ts`
     shows **one** regex declaration.
   - `grep -nE "\\[\\^\\\\s#\\]|\(\?!" apps/app/lib/inline-tags.ts` → zero hits (no old regex,
     no negative lookahead).
   - `grep -nE "eofTerminates|terminator|ponytail" apps/app/lib/inline-tags.ts` → the options
     object, the whitespace-terminator equivalence comment, and the `ponytail:` upgrade-path
     comment are all present.
3. **Pipeline-unchanged check:**
   - `git diff -U0 apps/app/lib/inline-tags.ts` shows `normalizeName`/`dedupeTags` bodies
     byte-unchanged.
   - `git diff --stat` shows no change to `note-compose.ts`, `tags-compose.ts`,
     `flush-payload.ts`, or `note-title.ts`.
4. **Contract 1 mechanical checks (`AGENTS.md`), now covering the editor:**
   - `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps/app/lib
     apps/app/app/note-editor.tsx apps/app/test/inline-tags.test.ts` → zero hits.
   - `grep -rn "next/link" apps/app/lib apps/app/app/note-editor.tsx` → zero hits.
   - No CSS/token/primitive change anywhere in the diff (`packages/ui/**` untouched).
5. **Frozen surfaces:** `git status --porcelain apps/app/test/e2e
   apps/app/public/manifest.json packages/ui/test/tokens.test.ts docs/specs/SPEC-ui-tokens.md
   docs/specs/SPEC-todo-ui.md apps/*/data` → **empty** (every e2e file byte-identical).
6. **E2E handover (the only browser run — human):** the human executes, exactly once,
   `npx playwright test --config apps/app/playwright.config.ts apps/app/test/e2e/journey.prod.spec.ts -g "create → edit → tag → search → reload keeps session → trash → restore → permanent delete"`
   and pastes the result back. No agent invokes Playwright or starts a server. If red, the
   pre-approved fallback from D11 is considered, and the run is repeated once (§3).
7. **Commit:** only after item 6 is green — explicit-path `git add` of the five owned files,
   then the D15 commit; no `-A`, no push, no merge.
8. **Five-lane close:** the change closes with the `five-lane-verification` skill — lane 1
   correctness/domain, lane 2 code quality, lane 3 security, lane 4 QA (runs the suite gate),
   lane 5 plan conformance (diff vs this plan and the T1 spec bullet). The gate must return
   **N/N PASS**; any lane FAIL → fix its blockers → re-run only the failed lanes → repeat
   until N/N PASS. No partial verdict is treated as done, committed, or merged. Merge to
   `master` still requires the user's explicit request.

## Definition of Done

- [ ] `apps/app/lib/inline-tags.ts` has exactly one `INLINE_TAG` regex (D2, strict) and a
      `parseInlineTags(body, { eofTerminates? })` options object implementing final mode as
      `` `${body} ` `` with the equivalence + `ponytail:` comments; `hasUncommittedTrailingTag`
      is exported; `normalizeName`/`dedupeTags` unchanged.
- [ ] `apps/app/test/inline-tags.test.ts` is renamed, the 4 breaking assertions are rewritten,
      and every kept/rewritten/scenario case passes with its stated mode.
- [ ] `apps/app/app/note-editor.tsx` implements the exact trigger map (strict debounce; final
      blur/Back/Save/pagehide/visibility-hidden/`keepMine`) and closes the dirty-check hole in
      `save` and `flushKeepalive`; `modeRef` resets in the drain `.finally`.
- [ ] `docs/specs/SPEC-notes-ui.md` states the exact grammar, the strict end-of-content rule,
      and the final-mode leave rule; `docs/specs/SPEC-todo-ui.md` is byte-unchanged.
- [ ] No files outside the allowed scope were modified; **every e2e file is byte-identical**;
      no dependency added; no `packages/**`, service, token/PWA or `apps/*/data/**` change.
- [ ] `npm run typecheck` (in `apps/app`) passes with zero errors.
- [ ] `npm run test:unit -- test/inline-tags.test.ts` (in `apps/app`) passes.
- [ ] Five-lane verification returns N/N PASS; the human-run targeted E2E is green; the
      explicit-path commit exists; `master` untouched and nothing pushed.
