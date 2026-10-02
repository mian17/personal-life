# 0008 — Enforce recall at the tool layer, not just in instructions

**Summary:** Enforce a process rule mechanically at the tool layer (a hook), never by instruction; global hook, lessons resolved per project from the session directory.

**Date:** 2026-10-01.

## The feedback

> "create a hook so that when i submit a prompt in opencode so that the agent will always
> read lessons learned scope to project dir"

## What it corrected

The global protocol wrote recall in as "read the repo's lessons before the first change",
but that stays a *convention* — it only works if the agent remembers to
follow it. The user asked for a mechanism, not another paragraph: a hook that makes the
recall happen at prompt submission regardless of what the agent remembers.

## The lesson

- A process rule that depends on an agent remembering something should be **enforced
  mechanically** at the tool layer. Instructions are advisory; hooks are unconditional.
- Match the mechanism to the scope of the data: the hook lives **globally** (auto-discovered
  from `~/.config/opencode/plugins/`) so it runs for every project, while the lessons it
  attaches are resolved **per project** from the session's `location.directory` — never from
  `ctx.location`, which is the plugin's location, not the session's.
- Implementation facts worth reusing: V2 reads a default export's `id` + `setup(ctx)`, so a
  plugin needs no package import; `ctx.session.hook("prompt", …)` intercepts admission and can
  push `event.prompt.files`; only push paths read from `readdir` — a hook-added file that
  fails resolution **aborts prompt admission**; the config dir is watched, so it hot-loads.
- Prove it before shipping: a fake-`ctx` harness exercised all five cases (attach, no
  duplicates, preserve existing, no-op without a lessons dir, never throw).
- **Inject a digest, not the bodies.** Attaching every full lesson on every prompt does not
  scale — the context cost grows with each lesson saved. The hook now emits one
  `path — summary` line per lesson (each file carries a `**Summary:**` line) to a single
  temp digest file and attaches only that; the full bodies stay on disk and are read on
  demand when a trigger matches. If the digest cannot be written, it degrades to attaching
  the full files so recall is never silently lost. A lesson without a `**Summary:**` line
  falls back to its title.

## Where

`~/.config/opencode/plugins/lessons.js` (plugin id `life.lessons`), paired with global
protocol §11.
