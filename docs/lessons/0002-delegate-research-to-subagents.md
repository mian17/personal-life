# 0002 — Do not research on your own; hand it to a subagent

- **Date:** 2026-10-01
- **Source:** user feedback (todo row date-colour investigation)

## Feedback

> "do not research on your own, hand that to the subagent"

## Lesson

When a question needs investigation (reading code, tracing a value, comparing
implementations), the tech lead does **not** dig through it inline. Dispatch the
investigation to a subagent with a bounded, read-only task and relay its verdict.

This matches the global protocol's role split: the tech lead orchestrates and
reviews; subagents execute bounded work.

## Applies to

Any "why does X happen / is this a violation / where does this come from"
question — delegate first, answer from the subagent's evidence.
