# 0001 — Record feedback as a lesson file — only when the user asks

- **Date:** 2026-10-01
- **Source:** user instruction
- **Amended:** 2026-10-01 — the user narrowed the rule: on request only, never automatically.

## Feedback

> "anytime i have a feedback on something, please save a lesson learned md file in the repo"

Amended by:

> "ok but it should be only record lessons learned when i tell you to, do not save everything"

> "i only want to save only when i tell you to, for example only save when i tell you this
> is something a lesson you should learn, because not every little feedback is worth recording"

## Lesson

Feedback is **not** captured automatically, and ordinary feedback is never assumed to be
lesson-worthy. Write a lesson file ONLY when the user explicitly says a piece of feedback
*is* a lesson to learn ("this is a lesson you should learn", "save this as a lesson",
"record this"). Absent that instruction, write nothing — most feedback is just a change to
make, and the reply is its record.

When the instruction is given, write it up as a markdown file here in `docs/lessons/`,
then act on it. A requested lesson is a durable rule, not a one-off reply.

This rule lives as a global rule in `~/.config/opencode/AGENTS.md` §11 as well; this file
is its project-scoped record.

## Convention

- One file per requested lesson, numbered sequentially: `NNNN-<slug>.md`.
- Fields: **Date**, **Source**, **Feedback** (the user's words), **Lesson** (the
  rule), and **Applies to** when it has a blast radius.
- The directory listing is the index — no separate index file.
- Record the lesson in the same commit as the change it drives, when there is one.

## Applies to

All work in this repo, going forward.
