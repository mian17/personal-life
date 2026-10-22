# 0012 — A later chapter can overwrite an earlier locked decision; per-chapter validation cannot catch it

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).

**Summary:** Read the governing intent/map before extending a surface; validation is intra-chapter, locked decisions are cross-chapter; a spec rationalization is a smell.

- **Date:** 2026-10-01
- **Source:** user question — why the tags-service Redis deployment was missed, after 0011

## Feedback

> "then why did we miss the docker deployment for tag service's redis, what was the
> reason, is it enough to earn a lesson learned?"

## What it corrected

0011 recorded the *artifact* failure (a shared instance; a stale map). It did not explain
the *mechanism* — how a documented, validated chapter shipped a design that violated an
earlier locked decision. Git archaeology (`git log -S`) put the mechanism on the record:

- `9981449` — the redis chapter wrote `docs/intent/redis-shared-state.md` decision 3
  ("one instance per service, not shared") and `MAP-redis.md` with its three modules.
- `26a8a39` — compose wired those three per-service instances correctly.
- `c4063b3` — the later todo-ecosystem chapter added the tags registry cache.
- `5356989` (T9) — wired tags/todo `REDIS_URL: redis://redis-note:6379`, **reusing** the
  existing instance instead of provisioning their own.
- `001e321` — `SPEC-service-kernel.md` wrote the sharing up as deliberate design:
  "All three services share the one `redis-note` instance — service-prefixed keys keep the
  namespaces disjoint."
- The chapter's plan then passed `validating-plans`, because the plan matched its own spec.

So the miss was not a typo or a dropped copy step. The later chapter **re-decided** the
wiring in its own spec and rationalized the deviation ("namespaced keys keep the namespaces
disjoint"). The validation gate checks a plan against *its* spec; a self-consistent
violation passes every check. The only artifact holding the real decision — the earlier
intent and map — was neither read nor updated.

## The lesson

- **Validation is intra-chapter; a locked decision is cross-chapter.** `validating-plans`
  can only verify that a plan matches the spec in front of it. If that spec silently
  overwrites an earlier decision, the loop is self-consistent and returns PASS. Cross-chapter
  invariants have no owner in a per-chapter validation loop — they need an explicit check.
- **Before extending a surface, read the governing intent/map of that surface.** A new
  chapter that touches Redis, the UI contract, the cache contract, an audience, a DB —
  anything with a standing decision — must reconcile with that decision, not restate the
  choice locally. "We'll share it" is a decision to be justified against the prior one, not
  a local option.
- **A rationalization in a spec is a smell.** "Namespaced keys keep the namespaces disjoint"
  sounded like a design justification but was an overwrite of decision 3. When a new spec
  explains why a previously-fixed rule is fine to bend, flag it and check the earlier artifact.

## Applies to

Every chapter that extends an existing surface: run `git log -S "<the invariant>"` (or read
the relevant `docs/intent/*.md` and `docs/specs/MAP-*.md`) before specifying wiring,
contracts, audiences, or shared resources. Planning and `validating-plans` tasks should include
a "governing-decisions" check against the earlier chapters the change touches.
