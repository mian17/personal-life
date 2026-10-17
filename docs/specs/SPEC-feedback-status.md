# Spec: feedback-status — feedback entry status workflow

Single-capability spec (scope check §1: one vertical capability, no capability map).
Traces to intent: `docs/intent/feedback-status.md` (confirmed). Touches both feedback
modules (`feedback-service`, `feedback-ui` of `MAP-feedback.md`) but is **not** a map
module: `MAP-feedback.md`'s "Out of scope (whole map)" listed "feedback status workflow"
and the new confirmed intent supersedes that line — flagged in §3, amended in the same
change during implementation. Storage follows the repo's spec system
(`docs/specs/SPEC-*.md`, the skill's "keep the project's existing conventions" rule).

Contracts: `AGENTS.md` Contract 1 (Shared UI), Contract 2 (BE → cache → DB),
`SPEC-feedback-service.md`, `SPEC-feedback-ui.md`, `SPEC-ui-tokens.md`.

## 1. Scope check & assumptions

**Scope check (honest verdict): one capability.** The ask is one workflow — a `status`
field on feedback entries with a settable value, a filter, and a colored pill. The
service-side and UI-side pieces share one data item and one acceptance story (flip to
Done → filter → pill); neither can ship or be verified alone, and neither can be cut
without rewriting the other's requirements. No capability map is written.

```
ASSUMPTIONS I'M MAKING:
1. One capability → one spec, saved at docs/specs/SPEC-feedback-status.md (repo
   convention; every MAP-*/SPEC-* artifact lives in docs/specs/, and the intent's
   tripwire wording names "SPEC-ui-tokens.md" — i.e. that directory).
2. Status vocabulary (wire): 'open' | 'in_progress' | 'done' | 'wont_do'; labels
   "Open", "In Progress", "Done", "Won't Do". Fixed set, any-to-any via the dropdown.
3. Default `open` is decided server-side (DB column DEFAULT + create path). The submit
   flow and `POST /api/feedback` body stay byte-identical; clients never send status.
4. Status is plaintext workflow metadata like `app`/`type` — no `@life/crypto`, no
   AAD, no `enc.v1.` envelope.
5. A status change writes the `feedback` row and bumps the owner cache generation; it
   writes NO `feedback_event` row and emits no event (the event contract — routing key
   `feedback.submitted`, message `{ event_id, feedback_id, owner_sub, app, type,
   occurred_at }` — is untouched).
6. Per-row dropdown = the existing `Select` atom (native `<select>`, options from data).
   Filter bar = `PillGroup` of `Pill as="button"` over the list. Status pill = `Pill`
   with status styling. All upstream in `packages/ui`.
7. The row is a new `ListItem variant="feedback"` upstream in `packages/ui` (the
   `variant="todo"` precedent, `packages/ui/src/components/list-item.tsx`); apps compose
   it and never roll their own row markup.
8. Status colors map to EXISTING semantic tokens — open→`--accent`,
   in_progress→`--amber`, done→`--green`, wont_do→`--muted` — four distinct colors, no
   new values on the frozen color surface. The tripwires (`packages/ui/test/tokens.test.ts`
   + `SPEC-ui-tokens.md`'s value table) gain the status→token mapping in the same change.
9. Filter state lives in the URL (`/feedback?status=open`; absent/unknown = All), not in
   client state. The filter is set by navigating a link, so `feedback/page.tsx` reads and
   validates `searchParams.status`, and the inbox narrows the already-loaded list in
   render — still no refetch and no service-side filtering (Contract 2 Rule 3 keeps
   filters out of the cache key regardless). Rationale: an in-memory filter needs a
   `useState`, which makes `feedback-inbox.tsx` a client component and drags `ListShell`
   and `navTrailing` into the client graph; the URL makes the shell server-rendered and
   the filter shareable/bookmarkable, matching the `/notes` filter-link pattern
   (`filterHref`). The per-row dropdown stays a leaf `'use client'` island.
10. A targeted e2e run is allowed by the repo profile (`e2e-run` knob, feedback-owned
    selectors only, one targeted run per chapter).
→ Correct me now or I'll proceed with these.
```

## 2. Objective

Give feedback entries a fixed status workflow so the owner's backlog distinguishes
"handled" from "still pending" without re-reading every entry.

Status vocabulary and transitions:

| Wire value | Label | Pill color (semantic token) | Set by |
|---|---|---|---|
| `open` | Open | `--accent` | default on submit (server-side) |
| `in_progress` | In Progress | `--amber` | owner, per-row dropdown |
| `done` | Done | `--green` | owner, per-row dropdown |
| `wont_do` | Won't Do | `--muted` | owner, per-row dropdown |

User stories / acceptance criteria:

- As the owner, I submit feedback and it appears in `/feedback` as **Open** with an
  Open pill — I never choose a status on submit.
- As the owner, I flip a row's status from the dropdown in the inbox row; any status
  goes to any other status (no workflow graph, no transition rules).
- As the owner, I filter the list by status (All / Open / In Progress / Done /
  Won't Do); the visible rows keep the existing app→type grouping and newest-first
  order within a filter.
- Each status renders as a color-coded pill with a distinct color per status.

Out of scope (from the intent; nothing here is spec'd): board/column view, custom
statuses, status history/audit trail, comments, assignment, notifications, per-status
count badges, submit-flow or event-pipeline changes beyond what a status change needs,
status palette theming.

## 3. Locked-interface flags (`MAP-feedback.md`)

The map's "Locked interfaces" are fixed; the confirmed intent authorizes exactly these
additive changes and requires them flagged here. Nothing else in the map is re-decided.

1. **`FeedbackDto` gains `status: FeedbackStatus`** (required on read; wire type stays
   in `@life/shared`). Additive — `id, app, type, title, description, createdAt` are
   unchanged.
2. **New route `PATCH /api/feedback/:id`** — body `{ status }`, alongside the locked
   `POST /api/feedback` / `GET /api/feedback`. Route family, prefix, and port are
   unchanged.
3. **`POST /api/feedback` is byte-identical** — same body, same `201 { id }`, same
   idempotency semantics; the status default is server-side (§4).
4. **Event contract untouched** — no new routing key, no message-shape change, no
   `feedback_event` row on status change (assumption 5).
5. **`MAP-feedback.md`'s whole-map out-of-scope line is superseded** by the new intent:
   during implementation the map's "feedback status workflow" out-of-scope entry and the
   `FeedbackDto` row are amended in the same change (doc upkeep, exactly like the 2026
   -10-15 title amendment recorded in `SPEC-feedback-ui.md`).

## 4. Data model, API & UI composition

### Data model (`apps/feedback-service`)

```
feedback(
  ...
  status TEXT NOT NULL DEFAULT 'open',   -- plaintext metadata, like app/type
  ...
)
```

- One `CHK_feedback_status` CHECK built from the shared vocabulary
  (`FEEDBACK_STATUS_VALUES`), the `CHK_feedback_type` pattern (lesson 0016: one owner
  per rule — DB CHECK and DTO `@IsIn` read the same constant).
- TypeORM `synchronize: true` — no migration framework; the column is additive and
  existing rows get `DEFAULT 'open'`.
- **Not encrypted**, deliberately (contrast the `enc.v1.` `title`/`description` AADs):
  a status is operational metadata, the same decision `app`/`type` already embodies.

### Service API (`apps/feedback-service/src/feedback/`)

- `PATCH /api/feedback/:id` — body `{ status }` where `status ∈ FEEDBACK_STATUS_VALUES`.
  Owner from `principal.sub`, never the body.
  - `200 { id, status }` on success. Setting the current status again is a no-op write
    returning the same `200 { id, status }` — never `409`.
  - `404` for a missing id or an id owned by another `sub` (byte-identical, never
    `403` — existence must not leak; the `POST` rule).
  - `400` on an invalid `status` value (the only validation status — no `422`).
- `GET /api/feedback` returns the same bare newest-first `FeedbackDto[]` with the new
  required `status` field per entry; `POST /api/feedback` unchanged (§3.3).

### BFF seam (`apps/app`)

- `apps/app/lib/feedback-api.ts` gains `updateFeedbackStatus(id, status)` (same
  `callService` forwarding as `createFeedback`).
- `apps/app/app/feedback-actions.ts` gains a `setFeedbackStatusAction(id, status)`
  server action: call the service, `revalidatePath('/feedback')`, map failures to one
  user message (`FeedbackSubmitResult` style).

### UI (`packages/ui` upstream first, then `apps/app`)

- `ListItem` gains `variant="feedback"` (the `variant="todo"` precedent): the feedback
  row's visual layout — title line, description snippet, meta line — is owned in
  `packages/ui/src/components/list-item.tsx` + its stylesheet, plus whatever slots the
  row needs for the status pill and the status dropdown (data in, visuals upstream).
- `packages/ui/src/components/feedback-status.ts` — the status vocabulary's labels and
  pill mapping (the `feedback-types.ts` precedent); `FEEDBACK_STATUS_VALUES` itself
  stays in `@life/shared` (wire vocabulary has one home).
- Status pill: `Pill` styled per status via the token mapping in assumption 8 — pill
  classes read `var(--accent)` / `var(--amber)` / `var(--green)` / `var(--muted)`, no
  raw colors (Contract 1 Rule 3 mechanical check).
- Per-row dropdown: the existing `Select` atom, options from the status vocabulary,
  accessible name identifying the entry (e.g. `Set status for <title>`), current status
  as `value`, `onChange` → `setFeedbackStatusAction`.
- Filter bar at the top of the inbox body, above the grouped sections: `PillGroup` of
  `Pill size="filter" as="a"` — All / Open / In Progress / Done / Won't Do, default All,
  active state via `Pill`'s `active`. Each pill is a navigation to the filtered URL
  (`filterHref`; All drops the `status` param). Filtering hides non-matching rows **and**
  any group that ends up with zero visible rows; the grouping/ordering of what remains is
  untouched.
  A filter that matches nothing shows an empty state with a filter-specific message —
  the existing `EMPTY_HEADING`/`EMPTY_BODY` strings ("No feedback yet." etc.) are
  untouched (frozen e2e selector surface).
- `apps/app/app/feedback/page.tsx` is the server shell: it reads and validates
  `searchParams.status` and loads the list, then `apps/app/app/feedback-inbox.tsx`
  composes the above server-rendered — it keeps its "groups and renders, never fetches"
  role (lesson 0018). The one client island is `apps/app/app/feedback-row.tsx` (the row's
  status dropdown, the `todo-item.tsx` precedent).

### Cache Rules (AGENTS.md Contract 2, Rule 4)

- **Cached shape:** the `feedback` row as persisted — `title`/`description` stay
  `enc.v1.` envelopes; `status` is cached as **plaintext metadata** alongside `app`/
  `type` (the row already carries plaintext metadata; content fields remain ciphertext).
- **Key composition:** unchanged — `feedback:<owner_sub>:v<gen>:list`. Status filters
  and pagination never enter the key (Rule 3): one entry serves every filter variant.
- **Invalidation:** a successful `PATCH` bumps the owner's generation counter after the
  row write commits (the `POST` pattern); TTL backstop as today. Domain events never
  drive invalidation — and a status change emits no event at all (§3.4).
- **Failure mode:** unchanged — fail-open to the direct loader on any cache error; the
  fallback path writes no plaintext.

## 5. Commands

Full commands from the repo profile. Touched workspaces: `packages/shared`,
`packages/ui`, `apps/feedback-service`, `apps/app`.

```
Typecheck:  npm run typecheck -w packages/shared
            npm run typecheck -w packages/ui
            npm run typecheck -w apps/feedback-service
            npm run typecheck -w apps/app

Unit test:  npm run test:unit -- <file>        # run inside the owning workspace
            e.g. cd packages/ui && npm run test:unit -- test/list-item.test.tsx

E2E (targeted, feedback-owned selectors only):
            npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

Testing policy: **max 2 test runs** per suite per task. No widened commands (no
`npm run test:e2e` full-suite, no extra runners).

## 6. Project Structure

```
packages/shared/src/index.ts                  → FEEDBACK_STATUS_VALUES, FeedbackStatus,
                                                FeedbackDto.status (wire types' one home)
packages/ui/src/components/list-item.tsx      → ListItem variant="feedback" (+ styles)
packages/ui/src/components/feedback-status.ts → status labels + pill/token mapping
packages/ui/src/styles/atoms.css|blocks.css   → status pill + feedback-row rules,
                                                values from tokens only
packages/ui/test/list-item.test.tsx           → variant="feedback" rendering
packages/ui/test/feedback-status.test.tsx     → pill class per status
packages/ui/test/tokens.test.ts               → tripwire: status→token mapping pinned
docs/specs/SPEC-ui-tokens.md                  → tripwire: value-table rows for the
                                                status mapping (same change)
apps/feedback-service/src/feedback/           → entity (status column + CHECK),
                                                dto/update-feedback-status.dto.ts,
                                                controller PATCH, service.updateStatus
apps/feedback-service/test/feedback.e2e-spec.ts   → route semantics (extend)
apps/feedback-service/test/feedback-harness.ts    → existing harness, reused
apps/app/lib/feedback-api.ts                  → updateFeedbackStatus()
apps/app/app/feedback-actions.ts              → setFeedbackStatusAction()
apps/app/app/feedback-inbox.tsx               → server shell: filter bar + grouping
apps/app/app/feedback-row.tsx                 → leaf client island: pill + status Select
apps/app/app/feedback/page.tsx                → reads ?status, validates, passes list down
apps/app/test/feedback-inbox.test.tsx         → filter/grouping/pill rendering (extend)
apps/app/test/routes-feedback-list.test.tsx   → page wiring (status parse + full list)
apps/app/test/e2e/feedback.spec.ts            → one targeted flip→filter chapter
docs/specs/SPEC-feedback-status.md            → this spec
```

## 7. Code Style

The repo's style: small documented functions, one owner per rule, vocabulary constants
shared between layers. Real snippet (the pattern the status CHECK follows, from
`apps/feedback-service/src/feedback/feedback.entity.ts`):

```ts
/**
 * `CHK_feedback_type` is built from the shared vocabulary so the DB CHECK and
 * the DTO's `@IsIn` can never drift (lesson 0016: one owner per rule).
 */
@Entity('feedback')
@Check('CHK_feedback_type', `type IN (${FEEDBACK_TYPE_VALUES.map((v) => `'${v}'`).join(',')})`)
export class Feedback {
```

Conventions: `var(--token)` for every color (never a literal); `cx(...)` for class
composition in `packages/ui`; owner always from `principal.sub`; doc comments state the
decision and its reason, not the code.

## 8. Testing Strategy

Framework: **jest** in every workspace (`npm run test:unit -- <file>`), **Playwright**
for the one targeted e2e chapter. Tests live beside each owner per §6. Coverage
expectations: every branch of the status vocabulary (all four values render their pill
class; the dropdown offers exactly the four labels) and every PATCH outcome (200, 400
invalid status, 404 foreign/missing id, idempotent repeat) has a test; tripwires updated
in the same change; no test is deleted or skipped to go green.

Levels per concern:

- **`packages/ui` (unit, renderToStaticMarkup pattern):** `variant="feedback"` row
  layout, pill class/token per status, `Select` options + accessible name;
  `tokens.test.ts` pins the status→token mapping against `tokens.css`/stylesheet rules.
- **`apps/feedback-service` (jest e2e-spec against the Postgres harness):** column
  default `open` on `POST`; `PATCH` semantics (§4); `GET` carries `status`; and the
  ciphertext test (the `notes-cache.e2e-spec.ts` pattern) — cached rows keep `enc.v1.`
  on `title`/`description` and plaintext `status`, so the cache-write site still passes
  the at-rest boundary check.
- **`apps/app` (unit):** inbox filtering (row and empty-group hiding, default All),
  grouping/order preserved within a filter, pill rendering, action wiring.
- **E2E (one targeted run, feedback-owned selectors only):** extend
  `apps/app/test/e2e/feedback.spec.ts` with one chapter — submit an item (starts Open),
  flip to Done via the row dropdown, filter Open → row gone, filter Done → row back with
  its pill. The frozen suite and frozen selector text are untouched.

## 9. Boundaries

**Always do:**
- Update both token tripwires (`packages/ui/test/tokens.test.ts`, `SPEC-ui-tokens.md`
  value table) in the same change as any status-color mapping (frozen-surface rule).
- Keep `title`/`description` ciphertext and `status` plaintext (§ Cache Rules); run the
  ciphertext test at every review touching the cache.
- Owner from `principal.sub`; `404` for foreign ids; `400` the only validation status.
- Keep app→type grouping and newest-first order as-is within any filter.
- Run Contract 1's mechanical greps at every review touching UI (raw elements,
  `next/link`, raw colors).
- Update this spec (and the `MAP-feedback.md` amendments of §3.5) in the same change as
  any decision change.

**Ask first:**
- Any `MAP-feedback.md` locked-interface change beyond the additive flags in §3 (e.g.
  `POST` body changes, an event routing key or message-shape change, a `feedback_event`
  write on status change).
- New color values on the frozen token surface (a `wont_do` hue distinct from `--muted`,
  or any new palette entry) — user approval required, per `SPEC-ui-tokens.md`.
- Changing existing e2e-visible text/roles/aria-labels (frozen selector surface).
- Raising the test-run budget above 2.

**Never do:**
- Put `status` in a ciphertext, an AAD, or the event message; emit `feedback.submitted`
  (or any event) on a status change.
- Put status filters or pagination into the cache key; let a cache error take the
  service down (fail-open only).
- App-rolled row/dropdown/pill markup in `apps/*` (raw `<select>`, `<button>`, styled
  spans, ad-hoc classes) — it goes upstream to `packages/ui` (Contract 1 Rule 1/3).
- Change frozen token values, `public/manifest-*.json`, or `viewport.themeColor`.
- Skip, delete, or weaken tests to get green; commit secrets; touch data directories,
  secrets, or ports; run production deploys or production data migrations.

## 10. Success criteria

1. Submitting feedback with no status in the request creates a row with `status =
   'open'`; the inbox row shows the Open pill (`--accent`) with zero client-side status
   logic in the submit flow.
2. From `/feedback`, setting a row's dropdown to Done: after the action resolves and
   `/feedback` re-renders (and after a full reload), the row shows the Done pill
   (`--green`); `GET /api/feedback` returns `"status":"done"` for it; repeating the same
   PATCH returns `200 { id, status: "done" }` and creates no new row or event
   (`feedback_event` count unchanged).
3. Filter "Open": the Done row is not in the DOM. Filter "Done": it is, with its pill.
   In every filter, app→type grouping and newest-first order match the unfiltered
   order; groups with zero visible rows are not rendered; filter "All" (default) matches
   today's inbox exactly.
4. `PATCH /api/feedback/:id` with `status: "archived"` → `400`; with another owner's or
   unknown id → `404`; `POST /api/feedback` behavior and payload are byte-identical to
   today (still `201 { id }`, no `409`).
5. The four statuses render four distinct pill colors, each reading its semantic token
   (`--accent`/`--amber`/`--green`/`--muted`); `tokens.test.ts` fails if the mapping
   drifts and `SPEC-ui-tokens.md`'s value table records it.
6. Cache/DB check: the service's cache suite asserts cached rows contain `enc.v1.` for
   `title`/`description`, no known plaintext, and plaintext `status`; a status change
   invalidates via the generation counter (next read returns the new status).
7. `npm run typecheck` clean in all four touched workspaces; the touched workspaces'
   `npm run test:unit` suites pass within the 2-run budget; the targeted Playwright
   chapter passes with `npx playwright test --config apps/app/playwright.config.ts
   <file> -g "<name>"`.
8. Contract 1 greps report zero hits for the new row/dropdown/pill code in `apps/*`:
   `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
   stays clean and no raw hex/rgb appears in app CSS.

## 11. Open questions

1. **Should "Won't Do" carry its own hue instead of `--muted` (gray)?** Spec'd as
   `--muted` to avoid adding a value to the frozen color surface; a distinct hue needs
   explicit user approval (assumption 8).
2. **URL-persisted filter (`/feedback?status=open`) — resolved.** Adopted (assumption 9):
   the filter is a URL search param, so the view is shareable/bookmarkable and the inbox
   shell renders on the server. Earlier draft spec'd in-memory client state; that was
   replaced because it forced the whole inbox into the client graph.
3. **Status-change events for downstream consumers?** Spec'd as no event at all
   (assumption 5); if the event pipeline ever needs transitions, that is a new
   capability with its own event type — never a reuse of `feedback.submitted`.
4. **`PATCH` response shape:** spec'd `{ id, status }` (mirrors `201 { id }`); flip to
   the full `FeedbackDto` if a consumer materializes.
5. **Optimistic dropdown feedback?** Spec'd as none — the pill updates when the server
   action resolves and the path revalidates; add optimistic UI only if the round trip
   feels slow in practice.
