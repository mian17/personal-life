# 0028 — An ambiguous noun in a change request: ask which surface (or all of them) before editing

**Summary:** When a request names a surface by a noun that two or more existing surfaces match literally (e.g. "the saved meal page" → the saved list *and* the one-meal detail route), ask one targeted question naming the candidates *and* an "all of them" option before editing — never pick the closest match and offer a fallback afterward, because the answer is often "both".

- **Date:** 2026-10-15
- **Source:** user correction — "i mean the saved list, save in the lessons that if you have lingering questions, do ask, not assume, revert that edit"; resolved by "hmm on second thought, detail not also have that too"

## Feedback

> "i mean the saved list, save in the lessons that if you have lingering questions, do ask, not assume, revert that edit"

The request was: *"for saved meal page, i don't want to see the header toolbar, just the back button is enough, can you change so?"*

Two routes match that noun literally, and I knew it at the time:

- `/meals/saved` — the saved-meals **list** (`SavedMealsPage`)
- `/meals/saved/[id]` — **one** saved meal's detail (`SavedMealPage`)

I picked the detail route on the singular "meal", argued myself into it (the detail
page's `MealsNav` was self-referential redundancy), shipped the edit to the wrong
surface, and closed with *"Say the word if you meant the list too."* That closing line
is the failure in one sentence: I had the doubt, resolved it myself, and billed the
user for the correction.

The follow-up then closed the loop — and it did not pick either of my two candidates:

> "hmm on second thought, detail not also have that too"

The intended answer was **both** routes. That is a third option I never enumerated, and
it was the right one. My guess was not even half-wrong — the detail page did need the
change — which is exactly what made guessing feel defensible. But "both" was invisible
from the code; only the user held it.

## What it corrected

- **A flag is not a question.** Naming an ambiguity in the *report* — after the edit is
  already made, verified, and committed — does not make the choice safe. It moves the
  cost of the doubt onto the user, who must now read the diff, notice the wrong page,
  and ask for a revert plus a redo. Two extra commits and a round trip bought nothing
  that one question up front would not have.
- **The doubt itself was the signal.** The moment I wrote "Scope call:" in my own
  reasoning, the ambiguity was established. §10's "doubt is not evidence" rule governs
  *reopening a settled answer*; it does not license resolving a genuinely open question
  of intent. Which surface the user meant is not a fact I can derive from the code — it
  lives only in the user's head.
- **Reverting is the right repair, not patching around it.** `git revert` (c22754f)
  restored the detail page and the change was then applied to the correct route
  (13770d4). Leaving the wrong edit in place "since it's also reasonable" would have
  shipped a UI change nobody asked for.
- **The follow-up changed the lesson.** After reading the corrected version, the user
  reconsidered: "hmm on second thought, detail not also have that too" — the answer
  turned out to be *both* surfaces (253b911). The first version of this lesson ("never
  change every matching surface") would have forbidden the eventual outcome. The
  error was never "one vs both" — both can be right, if the *user* says so. The
  error was deciding without asking.

## The lesson

- **A request that names a surface by an ambiguous noun gets one question, not a
  decision.** Enumerate the concrete candidates (route, component, file) in the question
  so the answer is a choice, not a clarification round trip. "The saved meal page —
  `/meals/saved` (the list), `/meals/saved/[id]` (one meal's detail), or both?" is the
  whole question. Offer the "both" option explicitly: it is a common answer, and a
  two-choice question forces the user into a split that may not exist in their head —
  as it did not here.
- **Ask before the edit, not after.** A question asked first costs one turn. A question
  asked after costs a revert, a redo, and the user's trust in the diff. There is no
  version of "I'll do the most likely one and say so" that beats asking.
- **Grammatical evidence is not intent.** Singular vs plural ("meal" vs "meals"), and
  "this surface looks redundant anyway", are my inferences about the user's mental model.
  They are reasons to *have* a question, never reasons to skip it. The grammatical reading
  actually pointed at the *detail* route — which is where the user, on reconsideration,
  wanted the change too.
- **Do not spend a fallback hedge where a question belongs.** "Say the word if you meant
  the other one" reads as diligence and functions as offloading. If the sentence would
  end in that hedge, stop and ask instead.
- **A correction is authoritative for today, not forever.** The user's first answer
  ("i mean the saved list") read as a decision that the detail page must stay as it was;
  it was a decision about *where to start*. Treat a follow-up "on second thought" as new
  information about intent, not as the user contradicting themselves — and when it
  arrives, update the lesson, not just the code.

## Applies to

Any change request that identifies its target by a noun rather than a path, route, or
component: "the editor", "the toolbar", "the settings page", "the day view". Pairs with
lesson 0022 (a literal ask that would remove a capability gets one precise question) —
0022 covers a request whose *effect* is wrong, this covers a request whose *target* is
ambiguous.
