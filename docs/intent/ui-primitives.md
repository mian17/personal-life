# Intent: shared UI primitives (notes app → reusable component layer)

Confirmed 2026-09-27 via interview (`interview-me`, explicit yes on the restate).
Build artifacts live in `docs/specs/` — map at `docs/specs/MAP-ui-primitives.md`.

## Outcome

A monorepo-internal UI primitives package — atoms (Button, Input, Checkbox, Card,
Dialog, …) plus app-level blocks (header/nav, list rows, page shell, empty states,
form layouts), carrying one visual language (tokens + fixed component APIs) — that the
notes app is rebuilt on, so future apps are assembled from it instead of built from
scratch.

## User

Me — every future frontend app in this workspace. First known consumer: the
`todo-service` UI (confirmed as the next chapter).

## Why now

`todo-service` is the confirmed next chapter. Without a primitives layer it means
rebuilding the same UI a second time; with it, the new app's screens are assembled
mostly from existing parts.

## Success

- The notes app is ported onto the primitives and **visually indistinguishable** from
  today (pixel-identical intent: refactor, not redesign).
- A new app's screens can be assembled mostly from existing primitives — speed.
- Look and feel is consistent **by construction** across apps — consistency is a
  first-class goal, not a side effect (shared tokens + fixed APIs).
- The primitives prove themselves against the only real UI we have (the notes app)
  *before* todo-service hits them — misfit primitives surface during the port.

## Constraint

Refactor, not redesign: the notes app must look and behave the same afterward.
Monorepo-internal only — no npm publishing, no multi-theme/branding system. Both
primitive levels are in scope (atoms **and** app blocks); blocks must be generalized,
not notes-shaped.

## Out of scope

- Building `todo-service` itself (the next chapter consumes the primitives).
- Any visual redesign or new look for the notes app.
- Multi-theme / branding systems.
- Backend work of any kind.
