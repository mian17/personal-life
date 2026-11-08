## What

_One or two sentences: what changed._

## Why

_The problem or requirement this addresses. If it fixes a user-visible defect, quote the report verbatim._

## Blast radius

_Who or what can break: which apps, services, surfaces, volumes, users. Call out anything irreversible, and any behaviour that changes for data that already exists (migrations, backfills, renames, deleted keys). If nothing can break, say so - do not leave this empty._

## Verification

_State the commands actually run and their results. The bar is: `npm run typecheck` in each touched workspace, the targeted test file(s) (`npm run test:unit -- <file>`), and a real run of any e2e or browser-observable change._

_Anything not actually run must be labelled `UNVERIFIED-BY-RUN` and named. An implied verification is not a verification._

## Rollback

_How to undo this, and whether the undo is safe - data migrations that cannot be reversed, deleted volumes, released tags/versions._

## Frozen surfaces

_Delete this list if untouched. Tick only what this PR changes - each tick requires explicit user approval and moves the guarding test in the same commit._

- [ ] UI token values (`packages/ui/src/styles/tokens.css` + `packages/ui/test/tokens.test.ts`)
- [ ] E2E selector surface (roles, visible text, aria-labels, `button.trash-delete`)
- [ ] PWA constants (`public/manifest-*.json`, `viewport.themeColor`)
