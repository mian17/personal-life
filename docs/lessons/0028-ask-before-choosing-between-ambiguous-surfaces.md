# 0028 — An ambiguous noun in a change request: ask which surface, before editing

**Summary:** When a request names a surface by a noun that two or more existing surfaces match literally (e.g. "the saved meal page" → the saved list *and* the one-meal detail route), ask one targeted question naming the candidates before editing — never pick the closest match and offer a fallback afterward.

- **Date:** 2026-10-15
- **Source:** user correction — "i mean the saved list, save in the lessons that if you have lingering questions, do ask, not assume, revert that edit"

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

## The lesson

- **A request that names a surface by an ambiguous noun gets one question, not a
  decision.** Enumerate the concrete candidates (route, component, file) in the question
  so the answer is a choice, not a clarification round trip. "The saved meal page —
  `/meals/saved` (the list) or `/meals/saved/[id]` (one meal's detail)?" is the whole
  question.
- **Ask before the edit, not after.** A question asked first costs one turn. A question
  asked after costs a revert, a redo, and the user's trust in the diff. There is no
  version of "I'll do the most likely one and say so" that beats asking.
- **Grammatical evidence is not intent.** Singular vs plural ("meal" vs "meals"), and
  "this surface looks redundant anyway", are my inferences about the user's mental model.
  They are reasons to *have* a question, never reasons to skip it.
- **Do not spend a fallback hedge where a question belongs.** "Say the word if you meant
  the other one" reads as diligence and functions as offloading. If the sentence would
  end in that hedge, stop and ask instead.
- **An ambiguous noun is not a licence to change every matching surface.** The tempting
  third option — do both pages so one of them is right — silently widens the blast
  radius past what was requested.

## Applies to

Any change request that identifies its target by a noun rather than a path, route, or
component: "the editor", "the toolbar", "the settings page", "the day view". Pairs with
lesson 0022 (a literal ask that would remove a capability gets one precise question) —
0022 covers a request whose *effect* is wrong, this covers a request whose *target* is
ambiguous.
