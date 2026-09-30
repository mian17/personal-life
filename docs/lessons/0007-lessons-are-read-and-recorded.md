# 0007 — Lessons are read before work and recorded on request

**Date:** 2026-10-01. **Amended:** 2026-10-01 — capture is on-request only, never automatic.

## The feedback

> "save in the global agents.md to always record and read lessons learned md based on
> user's feedback project scope"

## What it corrected

Lessons existed (`docs/lessons/0001`–`0006`) but the practice was one-directional and ad
hoc: feedback was written down when it arrived, but nothing required **reading** them
before starting work, and nothing made the practice binding outside this repo. A recorded
lesson that is never read back prevents nothing.

## The lesson

- **Recall is the other half.** Read the repo's lessons directory end to end before the
  first change in any repo — prior feedback shapes the current task.
- **Capture on request only.** A lesson is written only when the user explicitly asks;
  never automatically. Most feedback is just a change to make, and the reply is its record.
- **Scope per project.** Lessons live in the repo they were earned in; only a genuinely
  cross-project rule moves into the global `~/.config/opencode/AGENTS.md`.
- Now encoded as global §11 (recall + capture + scope) and as the `lessons` profile knob
  in this repo's `AGENTS.md`.
