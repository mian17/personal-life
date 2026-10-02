# 0016 — DRY: one owner per rule, never a second copy

**Summary:** DRY: one owner per rule, in code and in the plan; reuse shared layers before writing a local copy; don't over-collapse trivial one-liners.

- **Date:** 2026-10-02
- **Source:** user feedback while planning the `todo-due-repeat-notify` chapter

## Feedback

> "save lessons learned to always apply DRY principle, never repeat or duplicate code"

## What it corrected

The planning of the due-time / recurrence / push chapter kept producing **two places that
would each own the same rule**, and each one had to be collapsed to a single owner before
the plan was valid:

1. **Day derivation.** A timed due is a UTC instant, so the local calendar day had to be
   derived for `dueDateState`, `dueDateLabel`, `groupTodos`, and matrix urgency. Writing that
   same "instant → local `YYYY-MM-DD`" logic in four call sites (or once in the app and once in
   `@life/ui`) is the duplicate. It collapsed to one exported helper (`dueDay`) that every
   caller imports.
2. **Timezone ⇄ calendar math.** The service converts local ⇄ canonical, and the recurrence
   advance walks the local calendar. Two copies (one in the todo service, one in the BFF or the
   UI) would drift. It collapsed to one pure module inside the service
   (`due-time.ts` / `recurrence.ts`), consumed everywhere that needs it.
3. **The reminder instant.** Deriving "timed → the due instant; date-only → 09:00 national" at
   more than one site is the same rule twice. It collapsed to one `reminderAt(...)` on the
   service.
4. **The advance rule.** The next-occurrence calendar lives in exactly one helper
   (`nextOccurrence`), not inline in the tick path and again in a test fixture.
5. **The repeat label.** The row and the editor options both need "daily → Daily". Collapsed to
   one app-owned `repeatLabel(...)`, not two literal maps.

The repo already encodes DRY as a hard contract twice — Contract 1 (no re-implementing a
`@life/ui` primitive in an app; no per-app stylesheet) and Contract 2 (the second service must
not fork `notes-cache.ts`; extract the shared read-through cache first). This chapter was the
same instinct applied to *time*.

## The lesson

- **One rule, one owner.** Any non-trivial rule — a conversion, a derivation, a label mapping,
  a state machine — is written **once** and imported. A second copy is a bug waiting for the
  two copies to disagree; "it's only a few lines" is exactly how duplication starts.
- **DRY applies to the plan, not just the code.** When a plan lists the same rule under two
  tasks (or two files), that is the defect: assign it one owning task/file and have the others
  consume it. Reviewing for duplication at plan time is cheaper than de-duplicating two
  implementations later.
- **Reuse the shared layer before writing the local one.** Check `@life/ui` (visuals),
  `@life/shared` (types), `@life/cache` (cache) and the owning service's existing helpers
  *before* adding a private copy. A genuine gap is fixed upstream (Contract 1 Rule 3 / Contract
  2 Rule 4), never worked around beside it.
- **Don't over-collapse either.** DRY is about one owner for a *rule*; a one-line trivial
  expression used twice is not worth an abstraction (ponytail: the abstraction must earn its
  keep). The line is: is there a *decision* encoded here? If yes, one owner.

## Applies to

Every new capability across `apps/*` and `packages/*`: time/date math, label and copy maps,
validation rules, cache/loader logic, and any helper two call sites would otherwise each
re-derive. When the same derivation appears twice, stop and name the single owner before
writing either copy.
