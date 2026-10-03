# 0025 — A fix that closes a finding must be verified at the rendering level it changed

**Summary:** After changing how something renders, verify the rendered result (the emitted markup/DOM/text the user sees) — not the component props, not the type signature, and not an adjacent passing assertion; the smallest data-bearing fact is the reason the bug existed.

- **Date:** 2026-10-03
- **Source:** the dish-name fix and the row-shape investigation in the meals e2e work

## Context

The manual-meal bug (0022/0024) was caused by a row that stored the dish but rendered only
the calorie figure. The fix moved the dish into the row title. That fix's verification,
however, was a unit test on the component's props — it proved the prop was passed, not that
the user would see a dish.

When the e2e spec later re-ran, the helper that parses a meal row could not read a figure,
because it assumed the row's text *began* with the calorie read-out — true before the fix,
false after. The row's real shape had to be established by reading the emitted DOM
(`__title` line, `__sub` line) and the CSS (no `content:`, no `text-transform`, no hidden
glyph), not by reasoning about the JSX.

## The lesson

- **Verify the level you changed.** A rendering change is verified against the rendered
  output (the actual emitted markup/DOM/text); a prop or type change is verified against the
  rendered consumer, not the declaration. A passing assertion *near* the change is not proof
  of the change.
- **Establish the real shape from artifacts, not inference.** Read the emitted DOM and the
  relevant CSS before predicting what `innerText`/`textContent`/`allInnerTexts` will produce.
  Character-exact facts (a newline between flex lines, a literal `×`, absence of generated
  content) are what make a parser correct or broken.
- **A passing assertion and a failing helper can both be right.** A `filter({ hasText })`
  match and a structured parser can disagree; each must be checked on its own terms. The
  subagent who made the parser match also correctly flagged that the two row shapes (built
  and fallback) differ, rather than forcing one regex onto both.
- **After any fix, re-run the check that would have caught the original bug.** The dish fix
  should have re-run the row-parsing check; the recovery took an extra investigation cycle.

## Applies to

Any change to rendered output (UI, templates, emails, API serialization) and any test
helper that parses that output. Related to lesson 0020 (visual rules are verified at the
rendered level) — 0020 covers visual contracts, this covers data-bearing rendered text.
