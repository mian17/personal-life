# 0001 — Record every piece of feedback as a lesson file

- **Date:** 2026-10-01
- **Source:** user instruction

## Feedback

> "anytime i have a feedback on something, please save a lesson learned md file in the repo"

## Lesson

Every time the user gives feedback on something, write it up as a markdown file
here in `docs/lessons/`, then act on it. Feedback is a durable rule, not a
one-off reply.

## Convention

- One file per piece of feedback, numbered sequentially: `NNNN-<slug>.md`.
- Fields: **Date**, **Source**, **Feedback** (the user's words), **Lesson** (the
  rule), and **Applies to** when it has a blast radius.
- The directory listing is the index — no separate index file.
- Record the lesson in the same commit as the change it drives, when there is one.

## Applies to

All work in this repo, going forward.
