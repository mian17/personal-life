# 0013 — Load a skill with the skill tool, never by searching the filesystem

- **Date:** 2026-10-01
- **Source:** user feedback while starting the `validating-plans` gate

## Feedback

> "you just read the skill, why the fuck you search for another"

## What it corrected

Needing to follow the `validating-plans` skill, I tried to fetch its instructions from
disk instead of invoking it: `read ~/.agents/skills/validating-plans/SKILL.md` (file not
found), then a `find`/`grep` sweep across `~/.agents`, `~/.config`, and `/`, then
`read ~/.claude/skills/validating-plans/SKILL.md` — which the user declined. The
instructions were **one `skill` tool call away**, and I had already used that tool three
times earlier in the same session (`using-agent-skills`, `spec-driven-development`,
`planning-and-task-breakdown`). Invoking it then loaded `validating-plans` correctly on the
first try, resolving it to `~/.claude/skills/validating-plans` — a base directory none of my
guesses had tried.

## The lesson

- **A skill is a tool to invoke, not a file to grep.** To load one, call the `skill` tool
  with its id; never hunt the filesystem for a `SKILL.md`.
- **The skill tool is the resolver.** Skills live under multiple roots
  (`~/.agents/skills`, `~/.claude/skills`, project-local `.claude/skills`, …). Hard-coding
  one base path is guaranteed to miss whatever lives elsewhere, and a filesystem sweep burns
  calls and risks reading a stale or unrelated copy.
- **You do not need the path to use the skill.** When a skill is needed mid-workflow,
  invoke it immediately — its content, including the true base directory, arrives in the
  result. Reading the path first is inverted work.

## Applies to

Every skill invocation, in any project (global process §8's skill chaining and the
discovery flow).
