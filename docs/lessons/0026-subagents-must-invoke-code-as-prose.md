# Subagents must invoke the code-as-prose skill when coding

**Summary:** Every delegated coding task (feature implementation or bug fix) must instruct
the subagent to load the `code-as-prose` skill; naming the skill in the prompt is not enough —
it must be invoked, because a fresh-context agent cannot see it otherwise.

## The feedback (verbatim)

> "are the subagents using the skill code as prose when coding"
> "save into a lesson, subagent must invoke the skill when coding, this applies when
> implementing and bug fixes"

## What it corrected

The delegation prompts carried a line from the global §5 template — *"Code style: code must
read as prose … Follow every rule of the `code-as-prose` skill"* — but that is a **reference,
not the skill's content**. A subagent starts with fresh context and the skill tool is not
available to it, so "follow `code-as-prose`" told the agent nothing it could act on. Code
style was therefore honored by luck, not by design: some subagent output read well, some
(finder/mapper expressions, short names) drifted dense — exactly what the skill's rules
4 and 9 push against. I could not tell which, because the rules were never in the agent's
context.

## The reusable lesson

Telling a subagent to "follow skill X" does not give it skill X. For any task that writes
or edits code — **implementation and bug fixes alike** — the delegated prompt must instruct
the subagent to **invoke the skill** (via its skill tool) before coding, so its rules enter
context. This applies to every coding handoff, not just ones where a bug report mentions
style. The instruction belongs in the "Code style" bullet of the §5 Mandatory Subagent
Task Template, paired with the skill's own test: read the body aloud to someone who has
never seen it — if it does not sound like a sequence of sentences, it is not done.
