# Spec: feedback-ui — shared submit form + `/feedback` owner inbox

Module id: `feedback-ui` (see `MAP-feedback.md`). Traces to intent:
`docs/intent/feedback-service.md`. Depends on `feedback-service` (build order:
`feedback-infra` → `feedback-service` → `feedback-ui`).

All work follows AGENTS.md Contract 1 (Shared UI Contract): every visual element maps an
existing `@life/ui` primitive; anything missing goes upstream to `packages/ui` (spec first),
never into `apps/*` as a fork.

**Amendment 2026-10-15 (user-authorized):** the form gains a **required title** above the
description (`Input`, `aria-label="Title"`, `FEEDBACK_TITLE_MAX` = 200) and the inbox row
splits into title (`ListItem` `title`) + description (`ListItem` `snippet`). This is the
map-locked "change to `feedback-service`'s wire contract" the `## Boundaries` section
requires asking first; `docs/specs/MAP-feedback.md` and `SPEC-feedback-service.md` record
the same change.

**Amendment 2026-10-15 (user-authorized, form UX — supersedes the `aria-label`-only
decision):** every field renders a **visible label** above it and a **`placeholder`** inside
it; each required label carries a visible **required marker** (`*`) and the control keeps
`aria-required`. Rationale (lesson 0029): an
`aria-label` is an accessible *name*, invisible to a sighted user; a field the DB requires
must read as required to the user, not only to the validator. The label markup stays in this
block using the existing `.ui-field-label` class (+ `.ui-field-label--strong`,
`.ui-field-label__required`) — **no new atom**; see *Fit problems* 2, which supersedes the previous
"no label primitive for fields" note. The general automation — publishing the field contract
from `@life/shared` so one `Field` block derives label/marker/`maxLength`/invalid state with
no hand-placed markup — is **deferred** (user shelved it for a future plan).

**Follow-up (user-authorized, same day):** the stacked labels render in the app's **primary
text colour and bold** — `.ui-field-label--strong` (`color: var(--text)`,
`font-weight: 600`) — because the shared base class is the *quiet chip-row caption* (muted,
13.6px) used by `TagPicker` / `TagFilterNav`, which is the wrong treatment for a caption above
a field. The base rule is untouched, so those consumers render unchanged. The
`* Required field` legend was **removed entirely** (line, rule, test, spec record): the `*`
marker plus the control's `aria-required` carry the signal.

## Objective

One reusable submit-feedback form reachable from the top toolbar of every frontend app, and
a `/feedback` top-level route hosting the owner's inbox grouped by app then type,
newest-first.

- Notes/Todos/Feedback toolbars get a **Send feedback** item (`IconButton`); tapping it
  opens a `Dialog` with a three-way type picker (feature request / enhancement / bug
  report), a **required title** (one-line summary) and a **required description**; submit
  persists the entry through the BFF to `feedback-service`.
- The inbox row shows the entry's `title` with its `description` beneath it (`ListItem`
  `title` + `snippet`), so a long list stays scannable.
- `/feedback` is its own top-level app (own PWA identity, per lesson 0005) rendering the
  owner's entries grouped **app → type**, newest-first.
- A retry or double-tap produces exactly one row (client idempotency key, locked intent 5).

Out of scope stays as in the intent: status workflow, replies, attachments, notifications,
edit/delete, anonymous submission, the event consumer.

## Tech Stack

- `apps/app` — Next.js 15 App Router, React Server Components for reads, one Server Action
  for the submit seam (same pattern as `app/actions.ts` / `todo-actions.ts`).
- `@life/ui` — two new client blocks (`FeedbackForm`, `FeedbackNavItem`) composed from
  existing primitives; zero new visual language, tokens only.
- `@life/shared` — the wire types (`FeedbackApp`, `FeedbackType`, `FeedbackDto`,
  `CreateFeedbackInput`, `FeedbackSubmitResult`) live here, one source for `feedback-service`,
  the BFF client, and the UI blocks. `@life/ui` gains a workspace dependency on
  `@life/shared` (types-only; one line in `packages/ui/package.json`) so the type union is
  never triplicated.
- `@life/app-kit` — `RouteLayout` + `routeLayoutMetadata` for the `/feedback` segment
  layout (same mechanism as `notes/layout.tsx` / `todos/layout.tsx`).
- Data path: page → BFF client (`lib/feedback-api.ts`, `callService`) → `feedback-service`
  (`FEEDBACK_API_URL`). The browser never talks to the service directly.
- No new runtime dependencies (`lucide-react` icon only).

## Commands

```unknown
# typecheck (profile: typecheck)
npm run typecheck -w packages/ui
npm run typecheck -w apps/app

# targeted unit tests (profile: unit-test; append the test file)
npm run test:unit -w packages/ui -- test/feedback-form.test.tsx
npm run test:unit -w packages/ui -- test/feedback-nav-item.test.tsx
npm run test:unit -w apps/app   -- test/feedback-inbox.test.tsx

# one targeted e2e run, at the very end (profile: e2e-run)
npx playwright test --config apps/app/playwright.config.ts feedback.spec.ts -g "submit feedback"
```

`max-test-runs: 2` applies per verification; no full suites, no unqualified runner.

## Project Structure

```unknown
packages/shared/src/index.ts               # + FeedbackApp, FeedbackType, FeedbackDto,
                                           #   CreateFeedbackInput, FeedbackSubmitResult,
                                           #   FEEDBACK_TITLE_MAX (= 200),
                                           #   FEEDBACK_DESCRIPTION_MAX (= 2000)
packages/ui/src/components/feedback-form.tsx      # FeedbackForm + FEEDBACK_TYPES (new)
packages/ui/src/components/feedback-nav-item.tsx  # FeedbackNavItem (new)
packages/ui/src/components/list-shell.tsx         # fabHref/fabLabel/fabIcon become optional
packages/ui/src/index.ts                          # + FeedbackForm, FeedbackNavItem, FEEDBACK_TYPES
packages/ui/test/feedback-form.test.tsx          # new suite
packages/ui/test/feedback-nav-item.test.tsx      # new suite
packages/ui/test/list-shell.test.tsx             # + omitted-fab assertion
docs/specs/SPEC-ui-list-shell.md                 # documents the optional fab (same change)

apps/app/app/feedback/layout.tsx          # routeLayoutMetadata('/manifest-feedback.json', …)
apps/app/app/feedback/page.tsx            # owner inbox (force-dynamic)
apps/app/app/feedback-inbox.tsx           # grouping + list rendering (app glue)
apps/app/app/feedback-actions.ts          # submitFeedbackAction (server action)
apps/app/lib/feedback-api.ts              # listFeedback / createFeedback via callService
apps/app/app/notes/page.tsx               # navTrailing += <FeedbackNavItem app="notes" />
apps/app/app/todos-nav.tsx                # += <FeedbackNavItem app="todos" /> (todos + lenses)
apps/app/lib/auth/gate.ts                 # PUBLIC_EXACT += /manifest-feedback.json, /icon-feedback.png
apps/app/public/manifest-feedback.json    # NEW file — no existing manifest is edited
apps/app/public/icon-feedback.png         # NEW file
apps/app/test/manifests.test.ts           # + /feedback case
apps/app/test/gate.test.ts                # + new public paths
apps/app/test/feedback-inbox.test.tsx     # grouping suite
apps/app/test/e2e/feedback.spec.ts        # the one new e2e spec (new selectors only)
apps/app/test/e2e/services.ts, global-setup.ts, global-teardown.ts
                                          # harness also launches feedback-service
```

## Primitive reuse plan (Contract 1, Rule 2/3)

Every element of this module maps to an existing primitive — no raw HTML, no inline style,
no new app CSS, tokens only.

| Element | `@life/ui` primitive |
|---|---|
| Toolbar feedback trigger | `IconButton` (`<button aria-label="Send feedback">` + `MessageSquare size={20} aria-hidden />`) |
| Dialog container (modal, title, close) | `Dialog` (its `body`/`footer` slots) |
| Type selector (3 options) | `PillGroup role="group" aria-label="Feedback type"` + `Pill as="button"` with `aria-pressed` |
| Field labels (title + description) | existing `.ui-field-label` class as a `<label>` (`htmlFor` → control `id`), strengthened with `.ui-field-label--strong` (`color: var(--text)`, `font-weight: 600`) so a stacked caption reads as text instead of the quiet chip-row caption the base class carries; title label text `Title`, description label text `Description`, each followed by a visible `*` marker (class `.ui-field-label__required`, `aria-hidden`, `--danger`) |
| Title field | `Input` (`id` / `placeholder` / `aria-required` / `aria-invalid` / `maxLength` passthrough) |
| Description field | `Textarea` (`id` / `placeholder` / `aria-required` / `aria-invalid` passthrough) |
| Error surface (client + server) | `AlertBanner` with `role="alert"` |
| Submit control | `Button` (`type="button"`, `disabled` while pending) |
| Field group (label + control) | block-owned `<div class="ui-field">` (`--space-0-4` gap; label sits with its control) |
| Form field rhythm | `Dialog`'s own `.ui-dialog__body` flex gap — between field groups |
| Inbox page shell | `ListShell` (title + navTrailing + body; fab omitted via the optional fab props) |
| Inbox toolbar item | `ListShell` `navTrailing` slot (→ `NavBar`) |
| Page title | `ListShell` `title` → `PageTitle` |
| App group heading | `Section` (default `headingLevel="h2"`) |
| Type group heading | `Section` (`headingLevel="h3"`) |
| Grouped entries | `List` + `ListItem` (plain — **no** new variant, one row type per lesson 0018) |
| Entry timestamp | `LocalTime` (`dateTime={createdAt}`) |
| Empty inbox | `EmptyState` |
| Empty app/type group | not rendered (derived grouping, see *Empty states*) |
| Icons | `lucide-react` nodes (`MessageSquare`, `Settings`, …) passed into the primitives |

### Fit problems and where they are fixed

Contract 1 Rule 3: a fit problem is fixed **upstream** with a prop/slot/variant, never
worked around in the app.

1. **`ListShell` requires a fab** — the inbox has no create action (submission happens in
   the apps). Fix upstream: `fabHref` / `fabLabel` / `fabIcon` become optional; `FabLink`
   renders only when `fabHref` is given. Backward compatible (Notes/Todos always pass it),
   documented in `SPEC-ui-list-shell.md` in the same change, one assertion added to
   `list-shell.test.tsx`. This is chosen over an app-level bespoke shell, which would fork
   the page rhythm (lesson 0006).
2. **A field needs a visible label** — the form's fields are captioned by a visible label
   above the control plus a `placeholder` inside it, and required labels carry the marker.
   Fixed **in this block** with the existing `.ui-field-label` class plus two small additions
   in `blocks.css` (`.ui-field-label--strong`, `.ui-field-label__required`) — no new atom, no new
   spec, no `SPEC-ui-atoms.md` change. The earlier decision ("no label primitive; an
   `aria-label` on the control is enough", citing `recurrence-dialog.tsx`) is **superseded**:
   an accessible name is not a visible one, and a required field must read as required to the
   user, not only to the validator.
   - **Deferred (user-shelved):** the general fix is to publish the field contract from
     `@life/shared` (`FEEDBACK_FIELDS`: `{ key, label, placeholder, required, maxLength }`)
     and have one reusable `Field` block derive the label, marker, `maxLength` and
     `aria-invalid` from it, so no future form hand-writes an asterisk or a red border. Not
     built here; recorded as the direction for the next plan.
   - `recurrence-dialog.tsx`'s `Select aria-label="Frequency"` is a known remaining offender,
     migrated separately (out of this module's scope).
3. **`AlertBanner`'s tone union is `'warning'` only** — the error banner reuses the existing
   warning tone plus `role="alert"` (semantic error, not a new visual). No upstream change
   required; a `danger` tone is a deliberate future theme change (frozen token surface), not
   part of this module.
4. **Type selector: `PillGroup`/`Pill`, not `Select`** — three mutually exclusive choices
   that should all be visible at once; a native `Select` hides the set behind an OS picker.
   `PillGroup` + `Pill as="button"` + `aria-pressed` is the exact in-repo pattern for this
   (`recurrence-dialog.tsx`), so the block reuses it rather than inventing a segmented
   control. `Select` stays untouched.

## Component contracts

```tsx
// packages/ui/src/components/feedback-form.tsx ('use client')
export interface FeedbackFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which app the entry belongs to (`'notes' | 'todos' | 'feedback'`). */
  app: string;
  /** Submit seam: the app passes its server action. Receives the idempotency key. */
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** Dialog title (frozen visible text). Default "Send feedback". */
  title?: string;
  /** Submit button label. Default "Send". */
  submitLabel?: string;
}

// packages/ui/src/components/feedback-nav-item.tsx ('use client')
export interface FeedbackNavItemProps {
  app: string;
  onSubmit: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  /** IconButton aria-label (frozen visible text). Default "Send feedback". */
  label?: string;
}
```

`FeedbackNavItem` is the toolbar item: it renders the `IconButton` and owns the `open`
state internally (the app never manages dialog state), composing `FeedbackForm` inside.
`FeedbackForm`'s rendered structure:

```tsx
<Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<>
  <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
  <Button disabled={pending} onClick={submit}>{pending ? 'Sending…' : submitLabel}</Button>
</>}>
  {error != null && <AlertBanner role="alert">{error}</AlertBanner>}
  <PillGroup role="group" aria-label="Feedback type">
    {FEEDBACK_TYPES.map((t) => (
      <Pill key={t.value} as="button" active={type === t.value}
            aria-pressed={type === t.value} onClick={() => setType(t.value)}>{t.label}</Pill>
    ))}
  </PillGroup>
  <div className="ui-field">
    <label className="ui-field-label ui-field-label--strong" htmlFor={titleId}>
      Title <span className="ui-field-label__required" aria-hidden="true">*</span>
    </label>
    <Input id={titleId} placeholder="Short summary of your feedback"
           aria-required aria-invalid={errorField === 'title' || undefined}
           maxLength={FEEDBACK_TITLE_MAX}
           value={title} onChange={(e) => setTitle(e.target.value)} />
  </div>
  <div className="ui-field">
    <label className="ui-field-label ui-field-label--strong" htmlFor={descriptionId}>
      Description <span className="ui-field-label__required" aria-hidden="true">*</span>
    </label>
    <Textarea id={descriptionId} placeholder="What happened, and what did you expect?"
              aria-required
              aria-invalid={errorField === 'description' || undefined}
              value={description} onChange={(e) => setDescription(e.target.value)} />
  </div>
</Dialog>
```

The `aria-label="Title"` / `aria-label="Description"` attributes are **removed** in favour of
the visible labels. The resolved accessible names are unchanged (`Title` / `Description`), so
the existing frozen selectors `getByLabel('Title')` / `getByLabel('Description')` still
resolve — the selector surface does not move, only the mechanism that supplies the name.
Field ids come from React's `useId()` (`titleId` / `descriptionId`), bound to the labels with
`htmlFor` — the label-to-control association is by construction, never a hand-written id.

New frozen-surface strings introduced here (recorded so a later frozen suite can rely on
them): `aria-label="Send feedback"`, `aria-label="Feedback type"`, the visible field labels
`Title` / `Description` (each with its required marker), the placeholders `Short summary of
your feedback` / `What happened, and what did you expect?`, the client validation messages
`Title is required.` / `Description is required.`,
the labels `Feature request` / `Enhancement` / `Bug report`, `Send` / `Sending…` / `Cancel`,
the dialog title `Send feedback`, and the page title `Feedback`.

`FEEDBACK_TYPES` is exported from `feedback-form.tsx`:

```tsx
export const FEEDBACK_TYPES: readonly { value: FeedbackType; label: string }[] = [
  { value: 'feature_request', label: 'Feature request' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'bug_report', label: 'Bug report' },
] as const;
```

Wire values are fixed here; `feedback-service`'s spec and validation must accept exactly
`feature_request` | `enhancement` | `bug_report`. Default selected type: the first
(`feature_request`), so the form is always submittable on the type axis.

### Idempotency key (locked intent 5)

- Minted in `FeedbackForm` when the dialog opens: `crypto.randomUUID()` stored in a ref;
  regenerated on every fresh open.
- Every attempt for that open — retry after a network error, double-tap, Enter + click race —
  sends the **same** `id`.
- The submit `Button` is `disabled` while a request is in flight (first dedup guard); the
  service's unique index is the second.
- On success the dialog closes; a later open mints a new id (a genuinely new entry).
- A duplicate key never surfaces as an error: the service treats a repeat of an owned
  `id` as a no-op and returns the same `201 { id }` (it never emits `409`), so a retry or
  double-tap is indistinguishable from a fresh success — exactly one row holds either way.
- The id never leaves the request path: it is not persisted, logged, or cached.

### Validation

- **At-rest signal (lesson 0029):** both fields are required and **say so before the user
  submits** — each visible label carries the `*` required marker, the control carries
  `aria-required`, and the `placeholder` shows the expected shape. Validation on submit is
  the second line, never the only one.
- **Client rules (exact):** `title.trim().length === 0` → `'Title is required.'` (checked
  first); otherwise `description.trim().length === 0` → `'Description is required.'`. On
  either: no request is sent, the message renders in the `AlertBanner` (`role="alert"`, which
  announces it), the offending control gets `aria-invalid="true"` (`errorField`), and focus
  moves to it. The submit button is *not* disabled beforehand — an inert button hides the
  reason; pressing it teaches the rule.
- **Server-side surface:** the service validates again (`400` for a missing/blank title or
  description, one over `FEEDBACK_TITLE_MAX` (200) / `FEEDBACK_DESCRIPTION_MAX` (2000)
  characters, or an unknown type/app — there is no `422`). The server action maps any non-OK response
  to `{ ok: false, message: "Couldn't send feedback. Try again." }`, which renders in the
  same `AlertBanner`; the dialog stays open and the id is kept for the retry. The happy path
  never reaches it because the client rule mirrors it.

## Toolbar integration (exact files)

| File | Change |
|---|---|
| `apps/app/app/notes/page.tsx` | `navTrailing` fragment gains `<FeedbackNavItem app="notes" onSubmit={submitFeedbackAction} />` placed **before** the `Settings` `IconLink` (Settings stays last, per `SPEC-ui-list-shell.md`'s recorded order). |
| `apps/app/app/todos-nav.tsx` | Same item with `app="todos"`, also before `Settings`. This component is shared by `/todos` and its lenses, so they all inherit it. |
| `apps/app/app/feedback/page.tsx` | `navTrailing` gains `<FeedbackNavItem app="feedback" onSubmit={submitFeedbackAction} />`. **Decision:** the feedback app itself *does* show the item — the intent says "every frontend app" with no exception, the block exists anyway, and feedback-on-feedback is legitimate; it costs one line. |

Both existing files are server components; the server action is passed down as a prop (the
standard Next pattern). Notes sub-pages (`/notes/tags`, `/notes/trash`, settings) keep their
own navs untouched — v1 puts the item on each app's primary list toolbar, matching the
existing composition. Adding it to Notes sub-pages later is a one-line-per-page extension
(deferred, not a v1 requirement).

The item is an `IconButton`, not `IconLink`: it opens a dialog (a control), not a route, and
`IconLink` requires an `href` that does not exist.

## Data fetch

**Read** — `apps/app/app/feedback/page.tsx` (server component, `dynamic = 'force-dynamic'`):

```unknown
GET $FEEDBACK_API_URL/api/feedback   (Authorization: Bearer <caller's IdP token>, via callService)
→ FeedbackDto[]              owner-scoped, newest-first, no pagination in v1
```

`lib/feedback-api.ts` follows `lib/api.ts` exactly: `import 'server-only'`,
`const FEEDBACK_API_URL = process.env.FEEDBACK_API_URL ?? 'http://127.0.0.1:3008'`, one thin
`call<T>()` wrapper over `callService` (sibling env naming: `TAGS_API_URL`,
`TODO_API_URL`). Port 3008 is the chosen `feedback-service` port
(3001 notes, 3004 tags, 3005 todos are taken); `SPEC-feedback-service` binds `PORT`
default `3008` to match. The dev stack runs the service on 3108, so the app's dev env
overrides with `FEEDBACK_API_URL=http://127.0.0.1:3108`. The bare-array `FeedbackDto[]` return (no envelope, no cursor) is
matched by `SPEC-feedback-service`'s `200 FeedbackDto[]` for the same reason. Auth /
owner-scoping / decryption are the service's job (Contract 2); the BFF only
forwards the caller's token — no client-side auth of any kind.

**Write** — `apps/app/app/feedback-actions.ts`, a `'use server'` action:

```unknown
submitFeedbackAction(input: CreateFeedbackInput): Promise<FeedbackSubmitResult>
  → POST $FEEDBACK_API_URL/api/feedback  { id, app, type, title, description }  → 201 { id }
  → catch ApiError → { ok: false, message }   (duplicates return 201, never 409)
  → on ok: revalidatePath('/feedback')
```

### Cache Rules

This module owns **no cache layer**: the read-through cache, per-owner generation counter,
TTL and fail-open behavior live in `feedback-service` (Contract 2, `## Cache Rules` there).
The BFF fetches with `cache: 'no-store'` (inherited from `callService`) and the page is
`force-dynamic`; the browser caches nothing — no `localStorage`, no service-worker caching
of feedback, no description in a URL or search param.

## `/feedback` owner inbox

`app/feedback-inbox.tsx` is app-owned glue (like `note-list.tsx` / `todo-list.tsx`): it
groups and renders, it never fetches.

**Grouping (locked intent: app then type, newest-first):**

- Bucket by `app`, then by `type`, **preserving encounter order** — the service already
  returns newest-first, so stable bucketing keeps every group newest-first. No re-sort.
- App order: canonical `notes → todos → feedback`, unknown app ids last (alphabetical).
  Type order: canonical `feature_request → enhancement → bug_report`, unknown types last.
- Labels: app = `{ notes: 'Notes', todos: 'Todos', feedback: 'Feedback' }[app] ?? app`;
  type = `FEEDBACK_TYPES` lookup `??` the raw value — an id from a future app/type renders
  as itself instead of vanishing (forward compatibility).

**Rendering (list reuse mapping):**

```unknown
ListShell (title="Feedback", navTrailing=FeedbackNavItem, fab omitted)
└─ Section (h2, app label)            per app with ≥1 entry
   └─ Section (h3, type label)        per type with ≥1 entry
      └─ List
         └─ ListItem                  title = title, snippet = description,
                                     meta = <LocalTime dateTime=createdAt>
```

One row type: plain `ListItem` — no `variant`, no leading control, no href (v1 has no detail
route), no sibling row component (lesson 0018). The `title` renders the entry title; the
`snippet` renders the description (the primitive's own second line). `meta` is the created
timestamp through `LocalTime`, which renders dates through the one `@life/ui` helper
(lesson 0003). There is no today/overdue/relative-date
logic in this module, so lesson 0019 does not apply.

**Empty states:**

- Zero entries overall → `EmptyState` (`heading="No feedback yet."` plus `body` copy
  pointing at the toolbar item) instead of the group tree.
- App/type groups are **derived from entries**, so a group is never empty in v1: the
  "empty per group" requirement is met by construction — an unused type simply has no
  subgroup, and no heading renders over nothing. A group bucket that somehow arrives empty
  renders an inline `EmptyState` rather than an empty `<List>`; an empty `<List>` never
  renders.

## PWA identity (lesson 0005 — new files only)

`/feedback` is its own app, exactly like Notes/Todos:

- **New** `apps/app/public/manifest-feedback.json` — `id` / `start_url` / `scope` all
  `/feedback`, `name: "Personal Life — Feedback"`, `short_name: "Feedback"`,
  `display: standalone`, icon `/icon-feedback.png` (512×512, `purpose: any`), and the same
  light-app palette the sibling manifests use (`#0f1115`), copied as *values inside a new
  file*.
- **New** `apps/app/public/icon-feedback.png` — 512×512 PNG checked in as a binary asset,
  exactly like `icon-notes.png` / `icon-todos.png` (which are checked-in binaries, not
  generated). There is no per-route SVG and no rasterize/build step; the file is added to
  the repo as-is. iOS ignores SVG for the Home Screen, hence the PNG.
- **New** `apps/app/app/feedback/layout.tsx` — `routeLayoutMetadata('/manifest-feedback.json',
  'Feedback', '/icon-feedback.png')` + `export default RouteLayout`, mirroring
  `notes/layout.tsx`.
- **Edit** `apps/app/lib/auth/gate.ts` — add `/manifest-feedback.json` and `/icon-feedback.png`
  to `PUBLIC_EXACT` so they are fetchable with no session (they install like `/icon.svg`).

**Frozen PWA constants are untouched:** `manifest-notes.json`, `manifest-todos.json`,
`viewport.themeColor` in `root layout.tsx`, and `icon.svg` see no diff. This module only
adds files.

## Code Style

The call site (real, as it appears in `notes/page.tsx`):

```tsx
<ListShell
  title="Notes"
  navTrailing={
    <>
      <IconLink href="/notes/tags" label="Manage tags">
        <Tags size={20} aria-hidden />
      </IconLink>
      <IconLink href="/notes/trash" label="Trash">
        <Trash2 size={20} aria-hidden />
      </IconLink>
      <FeedbackNavItem app="notes" onSubmit={submitFeedbackAction} />
      <IconLink href={settingsHref('/notes')} label="Settings">
        <Settings size={20} aria-hidden />
      </IconLink>
    </>
  }
  …
/>
```

- Blocks own dialog state and copy defaults; the app owns data, grouping, and hrefs.
- No `any` at module boundaries; wire types come from `@life/shared`.
- New CSS: none expected — `Dialog`, `PillGroup`, `AlertBanner`, `Button`, `Section`, `List`
  and `ListItem` already own their classes. If the dialog body needs one spacing hook,
  exactly one `ui-feedback-form` class may be added to `packages/ui/src/styles/blocks.css`,
  token-only — never an app stylesheet, never an inline style.

## Testing Strategy

Frozen-surface stance first: the e2e selector surface (roles, visible text, aria-labels,
`button.trash-delete`), token values, and existing PWA constants are **not changed**. The
toolbar addition only *adds* a control; no existing query in `journey.suite.ts` / `journey.ts`
counts or positions toolbar controls (verified: their count assertions are `getByText` /
`getByLabel(Restore …)` on rows), and no existing label or role is touched. No existing
frozen spec file is edited.

**Unit / render (jest):**

- `packages/ui/test/feedback-form.test.tsx` — dialog opens/closes through `open` /
  `onOpenChange`; three type pills render with `aria-pressed`, clicking selects;
  blank-title submit sends **no** request and shows `'Title is required.'` with `aria-invalid`
  on the title input and focus moved to it; with a title but blank description, no request is
  sent and `'Description is required.'` shows with `aria-invalid` on the textarea; a valid
  submit calls `onSubmit` with `{ id, app, type, title, description }` (both trimmed) and
  closes; a rejected submit shows the error
  message, keeps the dialog open, and the **retry carries the same `id`**; reopening mints a
  **new** `id`; the button is disabled while pending; `onSubmit` receives the exact `app`
  passed in.
- `packages/ui/test/feedback-nav-item.test.tsx` — the `IconButton` carries the frozen
  `aria-label="Send feedback"` and opens the dialog; closed by default; success closes it.
- `packages/ui/test/list-shell.test.tsx` — omitted `fab*` renders no `FabLink`, existing
  slot-order assertions unchanged.
- `apps/app/test/feedback-inbox.test.tsx` — grouping: app → type nesting, newest-first order
  preserved inside groups, canonical group order, unknown app/type labels fall back to the
  raw id, zero entries → `EmptyState`, no empty `<List>`.
- `apps/app/test/manifests.test.ts` — third case: `manifest-feedback.json` has
  `id`/`start_url`/`scope` `/feedback`, `short_name` `Feedback`, and
  `feedback/layout.tsx` links `/manifest-feedback.json`.
- `apps/app/test/gate.test.ts` — the two new paths are public; everything else still gated.
- Existing suites (notes/todos UI, `todos-layout`) stay green — no label/selector change.

**E2E — exactly one targeted run** (profile `e2e-run`, ≤ 2 runs total):

- New file `apps/app/test/e2e/feedback.spec.ts`, one test
  (`-g "submit feedback"`): on `/notes` open the item → try a blank title (assert the error,
  no row created) → pick a type, write a title and a description, submit → `/feedback` shows
  the entry under the right app group and type group, with both lines visible. It uses only
  its **own new** selectors (`getByLabel('Send feedback')`, the three type pills, the title
  input, the description textarea, the heading `Feedback`) — nothing shared with the frozen
  suites, which are not edited.
- The harness (`test/e2e/services.ts` + `global-setup.ts` / `global-teardown.ts`) gains
  `feedback-service` alongside the existing services; the single run happens only once the
  `feedback-infra` stack is up.

## Boundaries

- **Always:** compose existing primitives (plan above); tokens only; one row type per list;
  the idempotency key per open, reused for every retry; title and description required on
  both sides;
  `@life/shared` as the single home of the wire types; new PWA files only; new e2e selectors
  only; update `SPEC-ui-list-shell.md` in the same change as the optional-fab edit.
- **Ask first:** editing the frozen e2e suites; running E2E beyond the one targeted run;
  changing token values (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`); editing
  existing PWA constants (`manifest-notes.json`, `manifest-todos.json`,
  `viewport.themeColor`); adding a `danger` tone to `AlertBanner`; adding a dependency;
  port/env changes beyond `FEEDBACK_API_URL`; any change to `feedback-service`'s wire contract.
- **Never:** raw `<button>/<input>/<textarea>/<a>/<label>` or styled `<div>` in `apps/*` UI
  code; inline `style=`; hex/rgb/px/rem in app CSS; a second app stylesheet; a per-app fork of
  the form or the inbox shell; `next/link` in `apps/*`; domain fetch inside `packages/ui`
  (`next/navigation`, `fetch`, `useRouter` stay out of the blocks); descriptions in
  `localStorage`/URLs; committing without the profile's typecheck + targeted tests; full test
  suites; modifying files outside this spec's Project Structure list.

## Success Criteria

1. From `/notes` and `/todos`, tapping **Send feedback** opens the dialog; submitting with a
   blank title shows `'Title is required.'` (a blank description with a title shows
   `'Description is required.'`) and creates no row; a valid submit closes the dialog and the
   entry appears on `/feedback` under the right app and type group, newest-first, showing the
   title with the description beneath it (verified by the one targeted e2e run).
2. A double-tap or a retry after failure yields exactly one feedback row and one event —
   unit-proven (same `id` on retry, fresh `id` only on reopen) plus the service's unique
   index.
3. The inbox groups strictly app → type with canonical order, renders an `EmptyState` at
   zero entries, and never renders an empty list; unknown app/type ids render as themselves.
4. `/feedback` installs as its own app: `manifest-feedback.json` + `icon-feedback.png` +
   route layout metadata pass; `git diff` shows **zero** changes to `manifest-notes.json`,
   `manifest-todos.json`, `viewport.themeColor`, and `icon.svg`.
5. Contract 1 mechanical checks clean:
   `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
   → only existing exemptions; `grep -rn "next/link" apps` → zero;
   no `style=` or raw color in `apps/app` feedback files; no `feedback`-domain copy required
   in `packages/ui` beyond `FEEDBACK_TYPES`/block defaults (no note/todo leakage either).
6. `npm run typecheck -w packages/ui`, `npm run typecheck -w apps/app`, and the targeted
   unit commands above are green; existing suites unchanged and passing.
7. Frozen e2e surface reproduced verbatim — no selector, role, visible text, or aria-label
   recorded in `SPEC-ui-list-shell.md`'s frozen list changes.
8. The three toolbars (Notes, Todos+lenses, Feedback) each render the item with the correct
   `app` id, Settings still last.

## Traceability (locked intent → this spec)

| Locked decision (`docs/intent/feedback-service.md`) | Section here |
|---|---|
| One shared submit form + shared toolbar item, each app passes its `app` id | *Component contracts*, *Toolbar integration* |
| Type = feature request / enhancement / bug report (three types) | `FEEDBACK_TYPES` in *Component contracts* |
| Title and description are required; both stay out of the event payload | *Validation*, *Primitive reuse plan* (locked intent 10) |
| `/feedback` is a new top-level route, its own app (own PWA identity) | */feedback owner inbox*, *PWA identity* (lesson 0005) |
| Inbox grouped by app, then type, newest-first | */feedback owner inbox — Grouping* |
| Client-supplied idempotency key → one row / one event on retry | *Idempotency key* (locked intent 5) |
| Owner-only, `principal.sub` from the JWT, no anonymous submission | *Data fetch* (BFF forwards the caller's token; service owns scoping) |
| Contract 1 + Contract 2 compliance | *Primitive reuse plan*, *Cache Rules*, *Boundaries* |
| Postgres/service/event/backup concerns | not here — `feedback-infra` / `feedback-service` specs |

## Open Questions

None. Decisions taken while writing, recorded here:

- **Feedback app shows the item too** (`app="feedback"`) — intent says "every frontend
  app"; no exception was carved out.
- **`FEEDBACK_API_URL` default port 3008** (dev overrides to `3108`) and a bare `FeedbackDto[]` from
  `GET /api/feedback` — fixed here and matched by `SPEC-feedback-service` and the
  locked interfaces in `MAP-feedback.md`.
- **Notes sub-pages** (`/notes/tags`, `/notes/trash`, settings) do not carry the item in v1;
  adding it is a per-page one-liner if wanted.
