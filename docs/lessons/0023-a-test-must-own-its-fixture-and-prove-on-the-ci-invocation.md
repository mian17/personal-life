# 0023 — A test must own its fixture; a full-suite pass does not survive a targeted-run failure

**Summary:** Every test creates the state it asserts — never inherit rows from an earlier test in the same file; and never report a "pass" from a different invocation than the one that will run in CI (a filtered run is a different execution, not a subset).

- **Date:** 2026-10-03
- **Source:** the `meals day view` e2e spec, after the five bug fixes

## Context

The meals feature was verified earlier with a targeted e2e run. Re-running the same spec
after the UI fixes showed 4/5 passing: `the day total is the sum of the confirmed entries`
failed because `listedEntryCalories()` returned `[]`. The read path, cache key, owner
(`sub`), and day were all proven stable and correct — the page simply had no rows.

## What it corrected

Root cause was **test design, not the product**: that test owned no fixture. It read rows
created by the two tests before it, so its result was a function of execution order. Every
other test in the file (and the journey suite) creates its data within itself; this was the
one exception, and it was invisible until a run where the ordering assumption did not hold.

The repair makes the test log its own entry, then assert the sum — and asserts *its own*
figure is present, so a mis-save fails loudly instead of silently summing a neighbour's row.

## The lesson

- **Every test owns its fixture.** Create the state the test asserts inside the test — never
  depend on a sibling test's writes, a suite-level ordering, or leftover DB state. If a test
  needs three rows, it creates three rows. This is what makes a single test runnable alone.
- **Assert identity, not just shape.** When a test creates a value, assert *that value* is
  what it reads back. "Non-empty" passes as long as anything exists — including the wrong
  thing.
- **A "verified" result only holds for the invocation that produced it.** A filtered run
  (`-g "name"`), a run with different parallelism, or a run on a different machine are
  different executions. Before declaring a spec green, run the invocation CI runs — and when
  a previously-green spec newly fails, suspect the test's own assumptions before the code.
- **Read the failure's proof chain, not its symptom.** `length > 0` failing is a symptom.
  Walking page → date → key → owner → query and showing each link is stable is what turns
  "flaky" into "this test reads something it never wrote".

## Applies to

Every automated test in this repo — e2e especially, where state is a shared database rather
than an in-test object. Pairs with lesson 0019 (today is the client timezone): both are
harness assumptions that silently decide whether a spec is meaningful.
