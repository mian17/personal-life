# 0009 — inline `#tag` creation on autosave leaks orphan tags

**Date:** 2026-10-01 — orphaned-tag investigation.

## The feedback

> "please also find the root cause to resolve the lingering issue" / "the root cause of
> that is because of the autosave feature of the notes app, there are intermediate tags
> across the app"

> "hmm how about when typing a note, i see that on apple reminder it only register as a
> tag only when the user begins with a # and then they finish typing a tag with a space,
> the system only then would recognize that as a tag. what do you think of this approach?"

> "also if the cursor is still beside the tagwords, when the note autosave it is recognize
> as text content and not a tag, tag is created on space"

## What it corrected

1. My first framing ("autosave creates a tag on every tick") was off by one layer. The
   defect is that a **registry row is created as a side effect of parsing a draft**: every
   400 ms flush re-parses the body (`apps/app/app/note-editor.tsx:122,238`) and
   `resolveInlineTagIds` fans out to `POST /api/tags`
   (`apps/app/lib/note-compose.ts:16-22` → `apps/app/lib/tags-compose.ts:40-51`), **before
   the note write is attempted**. Repeated autosaves of an *unchanged* body are idempotent,
   so idle autosave never multiplied rows — only a changing token did.
2. The parser `const INLINE_TAG = /#([^\s#]+)/g` (`apps/app/lib/inline-tags.ts:11`)
   matches a `#token` **regardless of what follows it**, so a partial token paused on
   mid-typing (`#fo`, then `#foobar`) becomes two rows, the first referenced by nothing.
   Two other orphan sources are inherent, not fixable at the trigger: a token later
   removed from the body, and a note write that fails/409s after the tag was already
   created. Todos cannot cause any of this — the todo editor only toggles existing tags.
3. The suite named this behavior "frozen": `apps/app/test/inline-tags.test.ts:4` is
   `describe('parseInlineTags (frozen inline #tag behavior)')`, and `:25` asserts that an
   unterminated `#two!` parses as a tag. Changing the parse rule therefore needs explicit
   approval, and those assertions must be rewritten with it.

## The lesson

- **Make a side effect a consequence of a committed thing, not of parsing a draft.** When
  an autosave path writes to a *registry* (permanent identity) while parsing in-flight
  text, the draft's intermediate states become durable rows. Creation must be gated on a
  terminator the user has actually produced — the Apple Reminders rule: a `#token` is a tag
  only when a whitespace terminator follows, and **end-of-content is not a terminator**
  (if it were, a paused partial token at the end of the body still matches and the fix
  does nothing).
- **Classify before choosing a tool.** Evolving-token orphans are a *trigger* bug and die
  with the terminator rule; detach and failed-write orphans are *inherent* to
  create-on-use and need a collector, not more conditions. That is what makes
  `cleanup-tags` a legitimate standing GC (remediation) rather than a workaround.
- **Declare the tradeoff explicitly:** a note ending on `#home` with no trailing space
  carries no tag until you type the space — user-learnable, and the price of eliminating
  the partial-token class. Rejected the alternative (EOF-tolerant parse at blur) as more
  plumbing than the evidence warrants; revisit only if it actually bites.

## Applies to

Any path that creates registry/vocabulary rows from in-flight user text — inline `#tag`
parsing, tag pickers, tag managers — and the `cleanup-tags` maintenance script
(`docs/specs/SPEC-tags-service.md`, `## Maintenance scripts`).
