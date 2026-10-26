# 0030 — A loop await is a design decision, not a defect

**Summary:** `S9382` ("await inside a loop") is a smell, not a finding to clear. Parallelise
only when the iterations are provably independent; when they are not, the sequential loop is
the correct code and the finding is closed as accepted, never "fixed" to satisfy a gate.

- **Date:** 2026-10-25
- **Source:** the SonarQube backlog sweep (PR #13), where two agents disagreed about the same
  two files

## What happened

Clearing 258 findings, `S9382` had 22 sites. Two subagents were given the same rule text and
reached **opposite conclusions on the same files**:

- `apps/app/app/pomodoro/actions.ts` — the first agent reported it as deliberately sequential;
  the retry agent rewrote it as `Promise.all`. Both sounded confident.
- `apps/app/scripts/generate-icons.mjs` — same split, same two agents.

Reading the code settled it: `setPomodoroDurations` calls `setPrefNumber` three times, and each
call ends in `revalidatePath('/', 'layout')`. Three concurrent revalidations is a real behaviour
change for no gain, so the sequential loop was right and the rewrite was reverted.

The rule text was the problem. "Hoist independent awaits into `Promise.all`" gives an agent
permission to decide *independent* on a glance, and a glance is not the level at which ordering
invariants are visible.

## The categories that must stay sequential

Every one of these looks parallelisable and is not:

1. **Ordered writes.** Rows inserted in a loop inside one transaction, or `UPDATE`s whose order
   the surrounding comment pins (`backfill.ts`, `rotation.ts`, `markReminded`). Batching or
   parallelising reorders the store.
2. **Loop-carried state.** A `Map.set` in iteration *n* read in *n+1* (`deks.set` in
   `backfill.ts`). `Promise.all` makes the read a race.
3. **A later await that depends on an earlier result.** `push.unsubscribe` runs only when the
   preceding `send` reported `GONE`; the dispatcher advances its cursor only after `publish()`
   confirms. These are not siblings, they are a chain.
4. **Rate-limited external calls.** `usda.client.ts` assumes one request at a time and treats
   `429` as `RATE_LIMITED`. Parallelising hammers the API and changes error semantics.
5. **Shared dedupe state.** `entry/[id]/actions.ts` passes a `pendingCreates` map so two frozen
   items with the same normalized name join one in-flight create. `Promise.all` races the
   dedupe and can insert two `Food` rows.
6. **Response-scoped writes.** Concurrent `Set-Cookie` writes and `revalidatePath` calls on one
   response are not order-safe.
7. **Per-row failure isolation.** A `try`/`catch` inside the loop means one bad row must not
   take the batch down; `Promise.all` rejects on the first failure.

## What to do instead

- Read the loop body **and its comments** before deciding. The ordering rationale is usually
  written down by whoever wrote it.
- If the iterations are independent, `Promise.all` over a `map` that preserves array order.
- If they are not, **leave the code** and close the finding as accepted with the reason. A
  finding that survives review is cheaper than an invariant that silently breaks.
- Never add a suppression comment to silence it. "Won't fix, sequential by design" is a
  SonarQube review state, not an `// NOSONAR`.

## Why this is a lesson and not a preference

The two agents were not careless — they were obedient to a rule that rewards rewriting. The
sweep's purpose was to reduce noise, and a parallelised ordered write trades a clean gate for a
race that only shows up under load. The gate is a measure; the invariant is the product.
