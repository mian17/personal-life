# 0031 — `await` in a loop is a correctness decision, not a perf toggle

**Summary:** `S9382` ("Unexpected `await` inside a loop") fired 18 times in this repo. An
`await` in a loop is either a **performance smell** (independent iterations) or a
**correctness requirement** (ordering carries meaning). The rule cannot tell them apart, so the
verdict is per site and written down, never a mechanical rewrite to `Promise.all`.

- **Date:** 2026-10-25
- **Source:** the `S9382` sweep, 18 sites across `apps/app`, `apps/note-service`,
  `apps/feedback-service`, `apps/todo-service`, `apps/meal-service`, `apps/idp`

## What happened

The rule text reads like an instruction: hoist independent awaits into a parallel map. Applied
blindly it converts a loop whose order is load-bearing into a concurrent one, and the result is
a latent data race that passes CI and fails under load, in a batch job, or on the second
concurrent retry.

So each of the 18 sites was read, judged, and recorded as fixed or accepted. Both verdicts are
results. A finding left open with a reason is cheaper than an invariant that silently breaks.

## Fixed — independent iterations, one awaited parallel map

Only two sites were genuinely independent:

- `apps/app/scripts/generate-icons.mjs` — five icons, each writing its own output file, no
  shared state between iterations.
- `apps/app/app/(meals)/meals/actions.ts` (`relogMealAction`) — one independent `POST` per frozen
  item, no ordering dependency between them.

## Must stay sequential — do not "fix" these

1. **Transactional batches.** `apps/note-service/src/keys/backfill.ts` (three sites): per-owner
   DEK insert, batch `UPDATE`, and encrypt-then-write all run inside one `ds.transaction`.
   `Promise.all` inside a transaction on one connection is at best serialised and at worst a
   detached-query error; concurrent row failure must abort the whole batch, which the loop's
   shared transaction already does.
2. **Rewrap under one transaction.** `apps/note-service/src/keys/rotation.ts`: one
   `ds.transaction`, per-row rewrap, same abort-everything semantics as the backfill.
3. **Ordered publication.** `apps/feedback-service/src/event/dispatcher.service.ts`: publish, then
   advance the cursor only when the broker confirms. Concurrent publishing advances the cursor
   past an unpublished event and loses it — ordering *is* the durability guarantee.
4. **Loop-carried request state.** `apps/idp/scripts/oidc-dance.ts` (`followToCode`): each
   iteration takes the redirect URL from the previous response. The loop is a chain, not a
   collection.
5. **Shared dedupe state.** `apps/app/app/(meals)/meals/entry/[id]/actions.ts`: a
   `pendingCreates` map lets two frozen items with the same normalized name join one in-flight
   create. Concurrent iterations race the dedupe and can persist two foods where one was meant.
6. **Per-row failure isolation.** `apps/todo-service/src/reminders/reminder.service.ts`: the
   `try`/`catch` inside the loop exists so one bad row cannot take the batch down. `Promise.all`
   rejects on the first failure and changes that contract.
7. **Rate-limited external calls.** `apps/meal-service/src/usda/usda.client.ts`: chunked fetches,
   one request at a time, `429` surfaces as `rate-limited` and is not retried. Parallelising the
   chunks hammers the API and turns one actionable rate limit into many.

## What to do instead

- Read the loop body **and its comments** before deciding. Whoever wrote the ordering rationale
  usually wrote it down.
- Fix only when the iterations provably share nothing: no transaction, no cursor, no map read in
  a later iteration, no response-scoped write.
- Otherwise leave the code alone and close the finding as accepted with the reason in this file.
  The verdict, not a suppression comment, is the record.
- Never `// NOSONAR` an `S9382`. "Sequential by design" belongs in a review state and in a
  lesson, not in the source.

## Why this survives review

`S9382` counts `await`s, not invariants. The mechanical reading is right about the shape and
blind to the meaning, so the only safe unit of judgement is the site. Two fixed, sixteen
accepted, each with the reason it must not move — that is the deliverable.
